import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeFileComponent } from './lib/safe-filename.mjs';

const long='2026년 울산도시공사 직원 채용공고 '.repeat(20);
const a=safeFileComponent(long,{maxBytes:64,maxChars:30});
const b=safeFileComponent(long,{maxBytes:64,maxChars:30});
assert.equal(a,b);
assert.ok(Buffer.byteLength(a,'utf8')<=64);
assert.match(a,/-[0-9a-f]{8}$/);

const actual=await fs.readFile('.github/workflows/update-jobs.yml','utf8');
const template=await fs.readFile('workflow-template/update-jobs.yml','utf8');
assert.equal(template,actual,'workflow template must be byte-identical to executable workflow');
assert.match(actual,/Start run metrics/);
assert.match(actual,/data\/run-metrics\.json/);
assert.match(actual,/Clean legacy diagnostic paths/);

let offenders=[];
async function walk(dir){let es=[];try{es=await fs.readdir(dir,{withFileTypes:true});}catch{return;} for(const e of es){const f=path.join(dir,e.name);if(e.isDirectory())await walk(f);else{const rel=path.relative('.',f);if(Buffer.byteLength(e.name,'utf8')>100||Buffer.byteLength(rel,'utf8')>210)offenders.push(rel);}}}
await walk('data/diagnostics');
assert.equal(offenders.length,0,`unsafe diagnostic paths remain: ${offenders.slice(0,5).join(', ')}`);
console.log('v92 safety/workflow guard pass', {safeName:a});
