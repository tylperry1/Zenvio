import {test} from 'node:test';
import assert from 'node:assert/strict';
import {postgresConnectionString} from '../src/lib/postgres-connection.mjs';
test('Legacy PostgreSQL SSL aliases retain current full certificate verification',()=>{
 for(const mode of ['prefer','require','verify-ca']){
  assert.equal(new URL(postgresConnectionString('postgresql://user:fixture@db.example.test/database?sslmode='+mode)).searchParams.get('sslmode'),'verify-full');
 }
});
test('Connection normalization preserves credentials, database and other options',()=>{
 const original='postgresql://fixture:p%40ss%3Aword@db.example.test:5432/business?sslmode=require&application_name=Zenvio&sslrootcert=%2Ftmp%2Ffixture-ca.pem';
 const before=new URL(original),after=new URL(postgresConnectionString(original));
 for(const key of ['protocol','username','password','hostname','port','pathname'])assert.equal(after[key],before[key]);
 for(const key of ['application_name','sslrootcert'])assert.equal(after.searchParams.get(key),before.searchParams.get(key));
 assert.equal(original.includes('sslmode=require'),true,'the source value remains unchanged');
});
test('Explicit libpq compatibility and local non-SSL connections remain unchanged',()=>{
 for(const value of ['postgresql://localhost/test','postgresql://localhost/test?sslmode=disable','postgresql://localhost/test?sslmode=verify-full','postgresql://localhost/test?sslmode=require&uselibpqcompat=true','postgresql://localhost/test?sslmode=require&sslmode=disable'])assert.equal(postgresConnectionString(value),value);
});
test('Non-URL connection formats remain the PostgreSQL driver’s responsibility',()=>{
 assert.equal(postgresConnectionString(undefined),undefined);
 assert.equal(postgresConnectionString('host=localhost dbname=fixture'),'host=localhost dbname=fixture');
});
