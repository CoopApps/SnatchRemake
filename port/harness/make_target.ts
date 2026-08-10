// DEV (harness): render a reference frame via the VDP emulator -> targets/<id>.raw
import fs from 'node:fs'; import path from 'node:path';
import { renderVdpFrame } from '../src/render/vdp.ts';
const [,, id, frameStr] = process.argv; const frame = Number(frameStr);
const S = path.join(import.meta.dirname,'..','rendered','intro','state.bin');
const buf = fs.readFileSync(S);
const vs=buf.readUInt32LE(10),cs=buf.readUInt32LE(14),vss=buf.readUInt32LE(18),rs=buf.readUInt32LE(22);
let o=26; const vram=new Uint8Array(buf.subarray(o,o+vs));o+=vs; const cram=new Uint8Array(buf.subarray(o,o+cs));o+=cs; const vsram=new Uint8Array(buf.subarray(o,o+vss));o+=vss; const reg=new Uint8Array(buf.subarray(o,o+rs));o+=rs;
const ad=(d:Uint8Array)=>{const c=buf.readUInt16LE(o);o+=2;for(let i=0;i<c;i++){const of=buf.readUInt16LE(o);o+=2;const l=buf.readUInt16LE(o);o+=2;d.set(buf.subarray(o,o+l),of);o+=l;}};
for(let f=1;f<=frame;f++){ad(vram);ad(cram);ad(vsram);ad(reg);}
const r=renderVdpFrame(vram,cram,vsram,reg);
const raw=Buffer.alloc(4+r.rgb.length); raw.writeUInt16LE(r.width,0); raw.writeUInt16LE(r.height,2); Buffer.from(r.rgb).copy(raw,4);
fs.writeFileSync(path.join(import.meta.dirname,'targets',`${id}.raw`),raw);
console.log(`target ${id} <- frame ${frame} (${r.width}x${r.height})`);
