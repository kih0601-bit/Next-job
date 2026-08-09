import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT='data/diagnostics';
const MAX_COMPONENT_BYTES=90;
const MAX_RELATIVE_PATH_BYTES=190;
let removed=0, scanned=0, removedSamples=[];
async function walk(dir){
  let entries=[]; try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
  for(const e of entries){
    const full=path.join(dir,e.name);
    if(e.isDirectory()) { await walk(full); continue; }
    scanned++;
    const relative=path.relative('.',full);
    const componentTooLong=Buffer.byteLength(e.name,'utf8')>MAX_COMPONENT_BYTES || e.name.length>100;
    const pathTooLong=Buffer.byteLength(relative,'utf8')>MAX_RELATIVE_PATH_BYTES;
    if(componentTooLong || pathTooLong){
      await fs.rm(full,{force:true}); removed++;
      if(removedSamples.length<20) removedSamples.push({relative,componentBytes:Buffer.byteLength(e.name,'utf8'),pathBytes:Buffer.byteLength(relative,'utf8')});
    }
  }
}
await walk(ROOT);
console.log({cleanup:'legacy-diagnostic-paths',scanned,removed,maxComponentBytes:MAX_COMPONENT_BYTES,maxRelativePathBytes:MAX_RELATIVE_PATH_BYTES,removedSamples});
