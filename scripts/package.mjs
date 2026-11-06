import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';
const manifest=JSON.parse(await readFile('dist/manifest.json','utf8')), files={};
async function walk(dir) { for(const entry of await readdir(dir,{withFileTypes:true})) { const p=join(dir,entry.name); if(entry.isDirectory()) await walk(p); else files[relative('dist',p).replaceAll('\\','/')]=new Uint8Array(await readFile(p)); } }
await walk('dist');
await mkdir('artifacts',{recursive:true});
const path=`artifacts/tab-sorter-${manifest.version}.zip`;
await writeFile(path,zipSync(files,{level:9})); console.log(path);
