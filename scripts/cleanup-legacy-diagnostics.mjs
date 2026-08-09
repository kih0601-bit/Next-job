import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT='data/diagnostics';
const MAX_BASENAME=150;
let removed=0, scanned=0;
async function walk(dir){
  let entries=[]; try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
  for(const e of entries){ const full=path.join(dir,e.name); if(e.isDirectory()) await walk(full); else {scanned++; if(Buffer.byteLength(e.name,'utf8')>MAX_BASENAME || e.name.length>120){await fs.rm(full,{force:true});removed++;}} }
}
await walk(ROOT);
console.log({cleanup:'legacy-diagnostic-filenames',scanned,removed,maxBasenameBytes:MAX_BASENAME});
