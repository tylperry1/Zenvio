import {createHash,createHmac,randomUUID} from "node:crypto";
import {getPool} from "../db";
import {integrationValue} from "../platform-settings";
import {ApiError} from "../server";
import {normalizeAttachment} from "../uploads";
const digest=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
const hmac=(key:string|Buffer,value:string)=>createHmac("sha256",key).update(value).digest();
const encode=(v:string)=>encodeURIComponent(v).replace(/[!'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());
export function r2SignedUrl(input:{account:string;bucket:string;key:string;accessKey:string;secret:string;method:"GET"|"PUT";expires?:number;now?:Date;filename?:string}){
 if(!/^[a-f0-9]{32}$/i.test(input.account)||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(input.bucket)||!/^owners\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(input.key))throw new ApiError("Invalid private storage path.");
 const expires=input.expires??60;if(!Number.isInteger(expires)||expires<1||expires>300)throw new ApiError("Invalid storage URL lifetime.");
 const date=(input.now||new Date()).toISOString().replace(/[:-]|\.\d{3}/g,""),day=date.slice(0,8),scope=day+"/auto/s3/aws4_request";
 const host=input.account+".r2.cloudflarestorage.com",path="/"+encode(input.bucket)+"/"+input.key.split("/").map(encode).join("/");
 const params:Record<string,string>={"X-Amz-Algorithm":"AWS4-HMAC-SHA256","X-Amz-Credential":input.accessKey+"/"+scope,"X-Amz-Date":date,"X-Amz-Expires":String(expires),"X-Amz-SignedHeaders":"host"};
 if(input.filename){params["response-content-disposition"]='attachment; filename="'+input.filename.replace(/[^A-Za-z0-9._ -]/g,"_").slice(0,150)+'"';params["response-content-type"]="application/octet-stream";}
 const query=Object.keys(params).sort().map(k=>encode(k)+"="+encode(params[k])).join("&");
 const canonical=[input.method,path,query,"host:"+host+"\n","host","UNSIGNED-PAYLOAD"].join("\n");
 const signingKey=hmac(hmac(hmac(hmac("AWS4"+input.secret,day),"auto"),"s3"),"aws4_request");
 const signature=createHmac("sha256",signingKey).update("AWS4-HMAC-SHA256\n"+date+"\n"+scope+"\n"+digest(canonical)).digest("hex");
 return "https://"+host+path+"?"+query+"&X-Amz-Signature="+signature;
}
async function config(){
 if(process.env.R2_STORAGE_ENABLED!=="true"||process.env.R2_PRIVATE_BUCKET_VERIFIED!=="true")throw new ApiError("Private R2 storage is not active.",503);
 const [account,bucket,accessKey,secret]=await Promise.all([integrationValue("R2_ACCOUNT_ID"),integrationValue("R2_BUCKET"),integrationValue("R2_ACCESS_KEY_ID"),integrationValue("R2_SECRET_ACCESS_KEY")]);
 if(!account||!bucket||!accessKey||!secret)throw new ApiError("Private R2 storage requires configuration.",503);return {account,bucket,accessKey,secret};
}
async function scan(data:Buffer){
 const endpoint=process.env.UPLOAD_SCANNER_URL,key=await integrationValue("UPLOAD_SCANNER_KEY");
 if(!endpoint||new URL(endpoint).protocol!=="https:"||!key)throw new ApiError("A verified upload scanner must be configured before R2 uploads.",503);
 const r=await fetch(endpoint,{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/octet-stream"},body:new Uint8Array(data),signal:AbortSignal.timeout(20000)});
 const result=await r.json().catch(()=>null);if(!r.ok||result?.clean!==true||result?.sha256!==digest(data))throw new ApiError("The upload did not pass content scanning.",422);
}
export async function uploadPrivateFile(userId:string,bytes:Buffer,filename:string){
 if(bytes.length<1||bytes.length>3000000)throw new ApiError("Upload a file under 3 MB.",413);
 const c=await config(),file=await normalizeAttachment(bytes,filename);if(file.data.length>3000000)throw new ApiError("Processed file exceeds 3 MB.",413);await scan(file.data);
 const id=randomUUID(),objectKey=`owners/${userId}/${id}`;
 await getPool().query("insert into private.stored_files(id,user_id,provider,object_key,filename,content_type,byte_size,sha256,scan_status) values($1,$2,'r2',$3,$4,$5,$6,$7,'clean')",[id,userId,objectKey,file.filename,file.contentType,file.data.length,digest(file.data)]);
 try{const r=await fetch(r2SignedUrl({...c,key:objectKey,method:"PUT"}),{method:"PUT",body:new Uint8Array(file.data),headers:{"Content-Type":file.contentType},signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error("storage_rejected");await getPool().query("update private.stored_files set state='stored' where id=$1 and user_id=$2",[id,userId]);return {id,filename:file.filename,contentType:file.contentType,byteSize:file.data.length};}
 catch{await getPool().query("update private.stored_files set state='failed' where id=$1 and user_id=$2",[id,userId]);throw new ApiError("Upload could not be confirmed.",503);}
}
export async function privateFileUrl(userId:string,id:string){
 const file=(await getPool().query("select object_key,filename from private.stored_files where id=$1 and user_id=$2 and state='stored' and scan_status='clean'",[id,userId])).rows[0];if(!file)throw new ApiError("File not found.",404);
 const c=await config();return {url:r2SignedUrl({...c,key:file.object_key,method:"GET",filename:file.filename}),expiresAt:new Date(Date.now()+60000).toISOString()};
}
