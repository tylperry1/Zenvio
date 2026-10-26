import { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// A preview must never mutate production's shared database.
if (process.env.VERCEL_ENV === 'preview') { console.log('Preview database migrations skipped.'); process.exit(0); }
if (!process.env.DATABASE_URL) {
 if (process.argv.includes('--if-configured')) { console.log('Database not configured; migrations skipped.'); process.exit(0); }
 throw new Error('DATABASE_URL is required');
}
const pool = new Pool({connectionString:process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL, max:1, connectionTimeoutMillis:15000});
const db=await pool.connect();
try {
 await db.query("select pg_advisory_lock(hashtextextended('zenvio-migrations',0))");
 await db.query('create schema if not exists private');
 await db.query('create table if not exists private.schema_migrations(name text primary key, checksum text not null, applied_at timestamptz not null default now())');
 for (const name of (await readdir(new URL('../postgres/migrations/', import.meta.url))).filter(n=>n.endsWith('.sql')).sort()) {
  const sql=await readFile(new URL('../postgres/migrations/'+name,import.meta.url),'utf8');
  const checksum=createHash('sha256').update(sql).digest('hex');
  const {rows}=await db.query('select checksum from private.schema_migrations where name=$1',[name]);
  if(rows[0]) {if(rows[0].checksum!==checksum) throw new Error('Applied migration changed: '+name);continue;}
  await db.query('begin');
  try {
   await db.query(sql.replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,''));
   await db.query('insert into private.schema_migrations(name,checksum) values($1,$2)',[name,checksum]);
   await db.query('commit'); console.log('Applied '+name);
  } catch(error) {await db.query('rollback'); throw error;}
 }
} finally { await db.query("select pg_advisory_unlock(hashtextextended('zenvio-migrations',0))"); db.release();await pool.end(); }
