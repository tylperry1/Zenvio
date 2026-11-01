import {postgresConnectionString} from "../src/lib/postgres-connection.mjs";
// Production-only, idempotent catalog setup. Never edits a price or subscription.
import { Pool } from 'pg';
import Stripe from 'stripe';
import {createDecipheriv,createHash} from 'node:crypto';
import {individualOffer,teamOffer,extraSeatOffer,catalogVersion,launchCouponId,launchProducts} from '../src/lib/subscription-offers.mjs';
if(process.env.VERCEL_ENV!=='production'||!process.env.DATABASE_URL){console.log('Subscription catalog provisioning skipped outside production.');process.exit(0);}
const pool=new Pool({connectionString:postgresConnectionString(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL),max:1,connectionTimeoutMillis:15000});
const db=await pool.connect();
async function secret(name){const r=await db.query('SELECT ciphertext FROM private.integration_secrets WHERE key=$1',[name]);if(!r.rows[0])return process.env[name]||'';if(!process.env.INTEGRATION_ENCRYPTION_KEY)throw Error('Integration encryption is not configured');const [iv,tag,data]=r.rows[0].ciphertext.split('.');const d=createDecipheriv('aes-256-gcm',createHash('sha256').update(process.env.INTEGRATION_ENCRYPTION_KEY).digest(),Buffer.from(iv,'base64'));d.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([d.update(Buffer.from(data,'base64')),d.final()]).toString();}
try{
 const key=await secret('STRIPE_SECRET_KEY'),webhook=await secret('STRIPE_WEBHOOK_SECRET');
 if(!key||!webhook){console.log('Recurring catalog setup pending: '+[!key?'Stripe secret key':null,!webhook?'subscription webhook signing secret':null].filter(Boolean).join(', ')+'.');}
 else {
  const stripe=new Stripe(key,{timeout:15000,maxNetworkRetries:2});
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('subscription-catalog-v1',0))");
  try{
   for(const offer of [individualOffer,teamOffer,extraSeatOffer]){
    const lookup=`zenvio_${offer.id}_monthly_${offer.monthly}_v3`;
    const found=await stripe.prices.list({lookup_keys:[lookup],limit:10});
    let price=found.data.find(p=>p.active&&p.currency==='usd'&&p.unit_amount===offer.monthly&&p.recurring?.interval==='month'&&p.recurring.interval_count===1);
    if(!price){const productId=`zenvio_${offer.id}_v3`;let product;try{product=await stripe.products.retrieve(productId);}catch(e){if(e.code!=='resource_missing')throw e;product=await stripe.products.create({id:productId,name:`Zenvio ${offer.name}`,metadata:{zenvio_offer:offer.id}},{idempotencyKey:productId});}if(product.deleted)throw Error('Subscription product is deleted');price=await stripe.prices.create({product:product.id,currency:'usd',unit_amount:offer.monthly,recurring:{interval:'month'},lookup_key:lookup,transfer_lookup_key:true,metadata:{zenvio_offer:offer.id}},{idempotencyKey:lookup});}
    await db.query("INSERT INTO private.subscription_prices(plan,period,stripe_price_id,catalog_version) VALUES($1,'monthly',$2,$3) ON CONFLICT(plan,period) DO UPDATE SET stripe_price_id=excluded.stripe_price_id,catalog_version=excluded.catalog_version",[offer.id,price.id,catalogVersion]);
    await db.query("INSERT INTO private.subscription_price_history(stripe_price_id,plan,period,catalog_version) VALUES($1,$2,'monthly',$3) ON CONFLICT DO NOTHING",[price.id,offer.id,catalogVersion]);
   }
   const couponId=launchCouponId;
   let coupon;
   try{coupon=await stripe.coupons.retrieve(couponId);}catch(e){if(e.code!=='resource_missing')throw e;coupon=await stripe.coupons.create({id:couponId,name:'Early adopter: 50% off first 3 months',percent_off:50,duration:'repeating',duration_in_months:3,applies_to:{products:launchProducts}},{idempotencyKey:couponId});}
   if(coupon.deleted||coupon.percent_off!==50||coupon.duration!=='repeating'||coupon.duration_in_months!==3||coupon.applies_to?.products.length!==2||!launchProducts.every(id=>coupon.applies_to.products.includes(id)))throw Error('Early-adopter coupon needs review');
   console.log('Individual, Teams base, and additional-seat recurring prices verified. Existing subscriptions unchanged.');
   await db.query("COMMIT");
  }catch(error){await db.query("ROLLBACK");throw error;}
 }
}finally{db.release();await pool.end();}
