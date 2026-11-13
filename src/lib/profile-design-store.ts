import {getPool} from './db';
import {parseProfileDesign} from './profile-design';
export async function publishedProfileDesign(owner:string,kind:'booking'|'smart',key:string){
 try{const {rows}=await getPool().query('SELECT published FROM private.profile_designs WHERE owner_id=$1 AND kind=$2 AND profile_key=$3',[owner,kind,key]);return rows[0]?.published?parseProfileDesign(rows[0].published):null;}
 catch(e){if((e as {code?:string}).code==='42P01')return null;throw e;}
}
