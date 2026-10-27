import { redirect } from 'next/navigation';
import { session, ApiError } from './server';
import { adminSession } from './admin';
export async function requirePageSession(admin=false){try{return await (admin?adminSession():session());}catch(e){if(e instanceof ApiError&&e.status===401)redirect('/sign-in');if(e instanceof ApiError&&e.status===403)redirect('/app');throw e;}}
