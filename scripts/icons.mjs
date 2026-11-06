import { mkdir, writeFile } from 'node:fs/promises';
import { zlibSync } from 'fflate';
// Code-native icon, generated with supersampling; no downloaded or third-party artwork.
const crcTable = Array.from({length:256}, (_,n) => { let c=n; for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1; return c>>>0; });
function chunk(name, data) { const type=Buffer.from(name), b=Buffer.concat([type,data]); let crc=0xffffffff; for(const v of b) crc=crcTable[(crc^v)&255]^(crc>>>8); const length=Buffer.alloc(4), sum=Buffer.alloc(4); length.writeUInt32BE(data.length); sum.writeUInt32BE((crc^0xffffffff)>>>0); return Buffer.concat([length,b,sum]); }
const round=(x,y,l,t,r,b,rad)=>x>=l&&x<=r&&y>=t&&y<=b&&(x>=l+rad&&x<=r-rad||y>=t+rad&&y<=b-rad||Math.hypot(x-(x<l+rad?l+rad:r-rad),y-(y<t+rad?t+rad:b-rad))<=rad);
await mkdir('public/icons',{recursive:true});
for(const size of [16,32,48,128]) {
  const pixels=new Uint8Array((size*4+1)*size);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const sum=[0,0,0,0];
    for(let sy=0;sy<4;sy++) for(let sx=0;sx<4;sx++) {
      const u=(x+(sx+.5)/4)*128/size,v=(y+(sy+.5)/4)*128/size;
      let c=round(u,v,2,2,126,126,28)?[84,84,216,255]:[0,0,0,0];
      if(round(u,v,26,25,101,47,6)) c=[190,190,255,255];
      if(round(u,v,26,53,101,75,6)) c=[225,224,255,255];
      if(round(u,v,26,81,101,103,6)) c=[255,255,255,255];
      if(u>=35&&u<=44&&v>=31&&v<=41||u>=35&&u<=44&&v>=59&&v<=69||u>=35&&u<=44&&v>=87&&v<=97)c=[84,84,216,255];
      c.forEach((n,i)=>sum[i]+=n);
    }
    sum.forEach((n,i)=>pixels[y*(size*4+1)+1+x*4+i]=Math.round(n/16));
  }
  const header=Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size,4); header[8]=8;header[9]=6;
  await writeFile(`public/icons/${size}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',Buffer.from(zlibSync(pixels))),chunk('IEND',Buffer.alloc(0))]));
}
console.log('Generated icons at 16, 32, 48, and 128 pixels.');
