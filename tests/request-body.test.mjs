import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
const filename=path.resolve("src/lib/server.ts"),m=new Module(filename);
m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
m.require=()=>({});
m._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {body}=m.exports;
const request=value=>new Request("https://fixture.invalid",{method:"POST",headers:{"Content-Type":"application/json"},body:value});
test("JSON accepts object payloads and rejects invalid JSON, arrays and non-JSON",async()=>{
  assert.deepEqual(await body(request('{"ok":true}')),{ok:true});
  for(const value of ["null","[]","bad"]) await assert.rejects(body(request(value)),e=>e.status===400);
  await assert.rejects(body(new Request("https://fixture.invalid",{method:"POST",body:"x"})),e=>e.status===415);
});
test("JSON limits count UTF-8 bytes rather than JavaScript characters",async()=>{
  await assert.rejects(body(request(JSON.stringify({text:"é".repeat(9000)}))),e=>e.status===413);
});
test("chunked JSON cancels reading as soon as the byte cap is exceeded",async()=>{
  let canceled=false,read=0;
  const stream=new ReadableStream({pull(controller){read++;controller.enqueue(new Uint8Array(9000));},cancel(){canceled=true;}},{highWaterMark:0});
  const r=new Request("https://fixture.invalid",{method:"POST",headers:{"Content-Type":"application/json"},body:stream,duplex:"half"});
  await assert.rejects(body(r),e=>e.status===413);assert.equal(canceled,true);assert.equal(read,2);
});
