/**
 * Current pg treats these legacy sslmode aliases as verify-full. Pin that
 * effective behavior without persisting or logging a modified secret.
 */
export function postgresConnectionString(value){
 if(typeof value!=='string')return value;
 try{
  const url=new URL(value);
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.searchParams.get('uselibpqcompat')==='true')return value;
  if(url.searchParams.getAll('sslmode').length!==1||url.searchParams.getAll('uselibpqcompat').length>1)return value;
  if(!['prefer','require','verify-ca'].includes(url.searchParams.get('sslmode')))return value;
  url.searchParams.set('sslmode','verify-full');
  return url.toString();
 }catch{return value;}
}
