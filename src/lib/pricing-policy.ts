import {getPool} from "./db";
/** Promotion visibility follows the same persisted switch as checkout eligibility. */
export async function launchPromotionEnabled(){
 try{return (await getPool().query("select value from private.platform_settings where key='pricing_v3_launch_promotion'")).rows[0]?.value?.enabled===true;}catch{return false;}
}
