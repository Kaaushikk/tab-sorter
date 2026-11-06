import { readFile } from 'node:fs/promises';
const pkg=JSON.parse(await readFile('package.json','utf8'));
const manifest=JSON.parse(await readFile('public/manifest.json','utf8'));
if(!/^\d+\.\d+\.\d+$/.test(pkg.version)||pkg.version!==manifest.version||process.env.GITHUB_REF_NAME!==`v${pkg.version}`) throw new Error('Tag, package version, and manifest version must match.');
console.log(`Version verified: ${pkg.version}`);
