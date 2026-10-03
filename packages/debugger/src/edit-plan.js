import {Op,verifyImage} from '@sharpforge/bytecode';

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const rude=message=>{throw new Error('Rude edit: '+message);};
const signature=m=>JSON.stringify([m.owner,m.name,m.isStatic,m.parameters.map(p=>p.type),m.returnType,!!m.isAsync]);
const defaultValue=t=>t==='int'||t==='double'?0:t==='bool'?false:null;
const localKey=l=>JSON.stringify([l.name,l.type,!!l.hidden]);
function uniqueMap(values,key,description){const result=new Map();for(const value of values){const k=key(value);if(result.has(k))rude('ambiguous '+description);result.set(k,value);}return result;}
function statement(image,p){if(!p)return '';return image.sources.find(s=>s.uri===p.uri)?.text.slice(p.start,p.end).trim()??'';}
function regions(method,pc){return method.handlers.flatMap((h,i)=>{const end=h.kind==='finally'?h.handlerEnd:method.code[h.end*3+1];return [pc>=h.start&&pc<h.end?`${h.kind??'catch'}:try:${i}`:null,pc>=h.target&&pc<end?`${h.kind??'catch'}:handler:${i}`:null].filter(Boolean);});}
function liveLocals(oldMethod,newMethod,frame){
  const map=new Map(),used=new Set(),locals=Array(newMethod.locals.length).fill(undefined);
  for(let i=0;i<oldMethod.locals.length;i++){
    const old=oldMethod.locals[i],matches=newMethod.locals.map((l,j)=>localKey(l)===localKey(old)&&!used.has(j)?j:-1).filter(j=>j>=0);
    if(matches.length>1)rude(`ambiguous live local '${old.name}' in ${oldMethod.qualifiedName}`);
    if(matches.length){map.set(i,matches[0]);used.add(matches[0]);locals[matches[0]]=frame.locals[i];}
    else if(!old.hidden&&frame.locals[i]!==undefined)rude(`removing or changing the type of live local '${old.name}' requires restart`);
  }
  return {map,locals};
}
/** Pure planning phase. Never mutates the running image, frames, or heap. */
export function planSourceUpdate(vm,input,{ensureAssigned}={}){
  if(!input||verifyImage(input).length)rude('candidate compilation did not pass verification');
  const old=vm.image,next=structuredClone(input),oldMethods=uniqueMap(old.methods,signature,'method signature'),candidateMethods=uniqueMap(next.methods,signature,'method signature');
  for(const key of oldMethods.keys())if(!candidateMethods.has(key))rude('removing methods or changing existing method signatures requires restart');
  const methodIds=new Map(),typeIds=new Map(),staticIds=new Map();let methodCount=old.methods.length,typeCount=old.types.length,staticCount=old.statics.length;
  for(const m of next.methods)methodIds.set(m.id,oldMethods.get(signature(m))?.id??methodCount++);
  const types=uniqueMap(old.types,t=>t.name,'type');for(const t of old.types)if(!next.types.some(n=>n.name===t.name))rude('removing a type requires restart');
  const extensions=[];
  for(const t of next.types){const previous=types.get(t.name);typeIds.set(t.id,previous?.id??typeCount++);if(previous){if(previous.fields.some((f,i)=>!equal(f,t.fields[i])))rude(`existing field layout of ${t.name} changed; fields may only be appended`);if(t.fields.length>previous.fields.length)extensions.push({name:t.name,from:previous.fields.length,fields:t.fields.slice(previous.fields.length)});}}
  const statics=uniqueMap(old.statics,s=>s.name,'static field');for(const f of old.statics){const n=next.statics.find(x=>x.name===f.name);if(!n||n.type!==f.type)rude('removing static fields or changing their types requires restart');}
  next.statics.forEach((s,i)=>staticIds.set(i,statics.has(s.name)?old.statics.indexOf(statics.get(s.name)):staticCount++));
  next.methods=next.methods.map(m=>({...m,id:methodIds.get(m.id)})).sort((a,b)=>a.id-b.id);
  next.types=next.types.map(t=>({...t,id:typeIds.get(t.id),...(t.initializer!==undefined?{initializer:methodIds.get(t.initializer)}:{})})).sort((a,b)=>a.id-b.id);
  next.statics=next.statics.map((s,i)=>({...s,_id:staticIds.get(i)})).sort((a,b)=>a._id-b._id).map(({_id,...s})=>s);
  next.entryPoint=next.entryPoint===null?null:methodIds.get(next.entryPoint);
  if(next.entryPoint!==old.entryPoint)rude('entry point changed');
  next.sequencePoints=next.sequencePoints.map(p=>({...p,methodId:methodIds.get(p.methodId)}));
  // CALL and delegate operands refer to managed identities, not syntax/declaration order.
  for(const m of next.methods)for(let i=0;i<m.code.length;i+=3){const op=m.code[i];if(op===Op.CALL||op===Op.DELEGATE)m.code[i+1]=methodIds.get(m.code[i+1]);else if(op===Op.NEWOBJ)m.code[i+1]=typeIds.get(m.code[i+1]);else if(op===Op.LDSTATIC||op===Op.STSTATIC)m.code[i+1]=staticIds.get(m.code[i+1]);}
  if(verifyImage(next).length)rude('remapped compilation failed verification');
  const frames=[],all=vm.allFrames?[...vm.allFrames()]:vm.frames;
  for(const f of all){
    const a=old.methods[f.methodId],b=next.methods[f.methodId],mapped=liveLocals(a,b,f);
    const normalize=(image,m,oldSide=false)=>{const code=[];for(let i=0;i<m.code.length;i+=3){let op=m.code[i],x=m.code[i+1],y=m.code[i+2];if(op===Op.SEQ){x=0;y=0;}else if(op===Op.CONST)x=typeof image.constants[x];else if(oldSide&&(op===Op.LDLOC||op===Op.STLOC))x=mapped.map.get(x);code.push([op,x,y]);}return code;};
    const sameInstructions=equal(normalize(old,a,true),normalize(next,b));
    let pc=f.pc,entryBridge=false;
    if(!sameInstructions&&a.name==='<startup>'&&a.owner==null&&!a.handlers.length&&!b.handlers.length&&a.code[(f.pc-1)*3]===Op.CALL){
      const target=a.code[(f.pc-1)*3+1],calls=[];for(let i=0;i<b.code.length;i+=3)if(b.code[i]===Op.CALL&&b.code[i+1]===target)calls.push(i/3+1);
      if(calls.length===1&&equal(normalize(old,a,true).slice(f.pc),normalize(next,b).slice(calls[0]))){pc=calls[0];entryBridge=true;}
    }
    if(!entryBridge&&(!sameInstructions||!equal(a.handlers,b.handlers))){
      // A top frame at a source checkpoint can relocate to the same surviving statement.
      // Suspended callers/await continuations may carry evaluation values and are intentionally
      // not guessed into changed instruction sequences.
      if(f!==vm.top||!vm.sourcePause||vm.stack.length!==f.base||a.code[f.pc*3]!==Op.SEQ)rude(`active method '${a.qualifiedName}' is not at an empty-stack source checkpoint`);
      const p=old.sequencePoints[a.code[f.pc*3+1]],text=statement(old,p),points=next.sequencePoints.filter(n=>n.methodId===b.id&&statement(next,n)===text);
      if(points.length!==1)rude(`active statement in '${a.qualifiedName}' was removed, changed, or is ambiguous`);
      pc=points[0].offset;
      if(!equal(regions(a,f.pc),regions(b,pc))||f.caught?.length)rude('active exception regions changed');
      ensureAssigned?.(b,pc,mapped.locals);
    }
    const points=next.sequencePoints.filter(p=>p.methodId===b.id&&p.offset<=pc);
    frames.push({frame:f,pc,locals:mapped.locals,localMap:mapped.map,point:points.at(-1)??null});
  }
  const heap=[];let addedBytes=0;
  for(let h=0;h<vm.heap.records.length;h++){const record=vm.heap.records[h];if(!record||record.kind!=='object')continue;const ex=extensions.find(e=>e.name===record.type);if(!ex)continue;const data=[...record.data,...ex.fields.map(f=>defaultValue(f.type))];addedBytes+=(data.length-record.data.length)*8;heap.push({reference:{h,g:vm.heap.generations[h]},data});}
  if(vm.heap.stats.liveBytes+addedBytes>vm.heap.maxBytes)rude('appended fields exceed the managed heap budget');
  const values=[...vm.statics,...next.statics.slice(vm.statics.length).map(s=>defaultValue(s.type))];
  const changes=next.methods.filter(m=>!old.methods[m.id]||!equal([...m.code],[...old.methods[m.id].code])||!equal(old.constants,next.constants)).map(m=>m.qualifiedName);
  return {image:next,frames,heap,statics:values,changes,addedMethods:next.methods.length-old.methods.length,addedTypes:next.types.length-old.types.length,appendedFields:extensions.reduce((n,e)=>n+e.fields.length,0),addedStatics:next.statics.length-old.statics.length};
}
/** Commit validated updates under a heap snapshot. Rollback includes budget/GC bookkeeping. */
export function commitSourceUpdate(vm,plan){
  const snapshot=vm.heap.snapshot();try{vm.heap.withRoots(plan.heap.map(item=>item.reference),()=>{for(const item of plan.heap)vm.heap.replaceData(item.reference,item.data);});}catch(error){vm.heap.restore(snapshot);throw error;}
  vm.image=plan.image;vm.statics=plan.statics;vm.constantValues.clear();
  for(const item of plan.frames){item.frame.pc=item.pc;item.frame.locals=item.locals;item.frame.point=item.point;}
  vm.currentPoint=vm.top?.point??null;for(const context of vm.scheduler?.contexts.values()??[])context.currentPoint=context.frames?.at(-1)?.point??null;
}
