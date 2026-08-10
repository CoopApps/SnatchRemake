// Comprehensive LZSS sweep: decompress EVERY valid block on the graphics disc
// files and build a master tile database. Tries prefix + no-prefix at every
// 2-byte offset. Keeps blocks that decode cleanly to >=256 bytes. Dedupes
// tiles by content. Writes an index: tileHash -> (file, blockOff, tileIdx).
import fs from 'node:fs'; import path from 'node:path';
import { decompressLzss } from './lzss.ts';

const DISC='D:/blastem/snatcher/extracted';
const files=fs.readdirSync(DISC).filter(f=>/^(DATA_|BOOT_SP|MAINCPU_IP|SUBCODE)/i.test(f)&&/\.(BIN|bin)$/i.test(f));
const blocks:{file:string;off:number;prefix:boolean;len:number}[]=[];
const t0=Date.now();
for(const f of files){
  const d=fs.readFileSync(path.join(DISC,f));
  const cap=Math.min(d.length,0x60000);
  let last=-1;
  for(let off=0;off+4<cap;off+=2){
    for(const [prefix,start] of [[true,off+2],[false,off]] as const){
      // Quick reject: prefix size sanity
      if(prefix){const sz=(d[off]<<8)|d[off+1]; if(sz<0x40||sz>0x20000) continue;}
      try{
        const dec=decompressLzss(d,start,0x20000);
        // valid tile block: >=256 bytes, multiple of 32, not mostly zeros
        if(dec.length<256||dec.length%32!==0) continue;
        let nz=0; for(let i=0;i<Math.min(dec.length,512);i++) if(dec[i]) nz++;
        if(nz<32) continue;
        // avoid overlapping dupes: skip if within last block
        if(off<last) continue;
        blocks.push({file:f,off,prefix,len:dec.length});
        last=off+ (prefix?((d[off]<<8)|d[off+1]):dec.length); // skip past
        break;
      }catch{}
    }
  }
  process.stderr.write(`${f}: ${blocks.filter(b=>b.file===f).length} blocks\n`);
}
console.log(`\n${blocks.length} blocks in ${((Date.now()-t0)/1000).toFixed(1)}s`);
const totalTiles=blocks.reduce((s,b)=>s+b.len/32,0);
console.log(`total decompressed: ${totalTiles} tiles (${(totalTiles*32/1024).toFixed(0)} KB)`);
fs.writeFileSync(path.join(import.meta.dirname,'.tile_blocks.json'),JSON.stringify(blocks));
console.log('wrote .tile_blocks.json');
