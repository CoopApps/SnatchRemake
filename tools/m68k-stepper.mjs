// Focused 68000 length-aware stepper: enough of the ISA to step instructions,
// compute lengths (incl. EA extension words), follow bra, and surface
// immediates + call/jump targets. Not a full emulator — a structural walker.
export function eaExt(mode, reg, sizeBytes){
  if(mode<=4) return 0;
  if(mode===5||mode===6) return 1;
  if(mode===7){ if(reg===0) return 1; if(reg===1) return 2; if(reg===2) return 1; if(reg===3) return 1; if(reg===4) return sizeBytes===4?2:1; }
  return 0;
}
const SZ={0:1,1:2,2:4};           // move: 1=byte,3=word,2=long handled separately
// returns {len, imm, call, jump, braTarget, isEnd}
export function decode(buf, a){
  const op=(buf[a]<<8)|buf[a+1]; let len=2, imm=null, call=null, jump=null, braTarget=null, isEnd=false;
  const m=(op>>3)&7, r=op&7;
  const dm=(op>>6)&7, dr=(op>>9)&7;           // dst mode/reg for move
  if(op===0x4E75||op===0x4E77||op===0x4E71){ isEnd=(op!==0x4E71); return {len,imm,call,jump,braTarget,isEnd}; } // rts/rte/nop
  if((op&0xF000)===0x7000 && (op&0x0100)===0){ imm={reg:dr, val:(op&0x80)?(op&0xff)-256:(op&0xff), size:1}; return {len:2,imm,call,jump,braTarget,isEnd}; } // moveq
  if((op&0xC000)===0 && (op&0xF000)!==0){ // move.b/.w/.l  (0x1/0x2/0x3)
    const t=(op>>12)&3; const sizeB = t===1?1:(t===2?4:2);
    const srcExt=eaExt(m,r,sizeB), dstExt=eaExt(dm,dr,sizeB);
    len=2+2*(srcExt+dstExt);
    if(m===7&&r===4){ imm={val: sizeB===4?((buf[a+2]<<24|buf[a+3]<<16|buf[a+4]<<8|buf[a+5])>>>0):((buf[a+2]<<8)|buf[a+3]), size:sizeB, dst:{m:dm,r:dr}}; }
    return {len,imm,call,jump,braTarget,isEnd};
  }
  if((op&0xF1C0)===0x41C0){ len=2+2*eaExt(m,r,4); return {len,imm,call,jump,braTarget,isEnd}; } // lea
  if((op&0xFF80)===0x4E80){ // jsr/jmp
    const ext=eaExt(m,r,4); len=2+2*ext;
    if(m===7&&r===1){ const t=(buf[a+2]<<24|buf[a+3]<<16|buf[a+4]<<8|buf[a+5])>>>0; if((op&0x40)) jump=t; else call=t; }
    isEnd=!!(op&0x40); // jmp ends flow
    return {len,imm,call,jump,braTarget,isEnd};
  }
  if((op&0xF000)===0x6000){ // bra/bsr/bcc
    let disp=op&0xff; if(disp===0){ disp=(buf[a+2]<<8)|buf[a+3]; if(disp&0x8000)disp-=0x10000; len=4; } else if(disp===0xff){ disp=(buf[a+2]<<24|buf[a+3]<<16|buf[a+4]<<8|buf[a+5]); len=6; } else if(disp&0x80) disp-=256;
    const target=a+2+disp; const cc=(op>>8)&0xf;
    if(cc===0){ braTarget=target; isEnd=true; }       // bra (unconditional) — follow
    else if(cc===1){ call=target; }                    // bsr
    return {len,imm,call,jump,braTarget,isEnd};
  }
  // immediate ops: ori/andi/subi/addi/btst-imm/eori/cmpi (0x0xxx)
  if((op&0xF000)===0){ const t=(op>>6)&3; const sizeB=SZ[t]||2; const immWords=(op&0x0800)?1:(sizeB===4?2:1); len=2+2*(immWords+eaExt(m,r,sizeB)); return {len,imm,call,jump,braTarget,isEnd}; }
  // addq/subq (0x5xxx), scc/dbcc
  if((op&0xF000)===0x5000){ if((op&0x00C0)===0x00C0){ if(m===1){ len=4; return {len,imm,call,jump,braTarget,isEnd}; } len=2+2*eaExt(m,r,2); return {len,imm,call,jump,braTarget,isEnd}; } len=2+2*eaExt(m,r,SZ[(op>>6)&3]||2); return {len,imm,call,jump,braTarget,isEnd}; }
  // tst/clr/neg/not (0x4xxx with EA), swap/ext
  if((op&0xFF00)===0x4A00||(op&0xFF00)===0x4200||(op&0xFF00)===0x4400||(op&0xFF00)===0x4600){ len=2+2*eaExt(m,r,SZ[(op>>6)&3]||2); return {len,imm,call,jump,braTarget,isEnd}; }
  if((op&0xFFF8)===0x4840||(op&0xFFB8)===0x4880){ len=2; return {len,imm,call,jump,braTarget,isEnd}; }
  // add/sub/cmp/and/or/eor (Dn <op> EA) families 0x8/0x9/0xB/0xC/0xD
  if([0x8,0x9,0xB,0xC,0xD].includes((op>>12)&0xf)){ const t=(op>>6)&3; if(t===3){ len=2+2*eaExt(m,r,4); } else { len=2+2*eaExt(m,r,SZ[t]||2); } return {len,imm,call,jump,braTarget,isEnd}; }
  // btst/bchg/bclr/bset dynamic (0x0xxx handled) ; bit ops reg (0x01xx) fall through
  return {len:2,imm,call,jump,braTarget,isEnd};
}
// walk a handler: follow bra, collect immediates + first shared-call, stop at rts/jmp/end
export function walkHandler(buf, start, maxSteps=40){
  let a=start; const imms=[]; let call=null; const visited=new Set();
  for(let n=0;n<maxSteps;n++){
    if(a<0||a+2>buf.length||visited.has(a)) break; visited.add(a);
    const d=decode(buf,a);
    if(d.imm) imms.push(d.imm);
    if(d.call!==null && call===null){ call=d.call; break; }
    if(d.braTarget!==null){ a=d.braTarget; continue; }
    if(d.jump!==null || d.isEnd) break;
    a+=d.len;
  }
  return {imms, call};
}
