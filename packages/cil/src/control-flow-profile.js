const inside=(offset,start,end)=>offset>=start&&offset<end;
const prefixes=new Set(['volatile.','tail.','constrained.','readonly.','unaligned.']);
/** Structural region/prefix checks complement stack-height verification. */
export function verifyControlRegions(inspector,method,issue) {
  const instructions=method.instructions,map=new Map(instructions.map((instruction,index)=>[instruction.offset,index]));
  const length=instructions.length?instructions.at(-1).offset+instructions.at(-1).size:0;
  // Decoders expose the body length even when the final instruction has no size.
  const boundary=offset=>map.has(offset)||offset===(method.codeSize??length)||offset===method.code?.length;
  const fail=(instruction,message,code='IL_EH')=>issue(method,instruction,code,message);
  const tails=new Set(),regions=[];
  for(let index=0;index<instructions.length;index++)if(prefixes.has(instructions[index].name)) {
    const prefix=instructions[index];let end=index+1;
    for(;end<instructions.length&&prefixes.has(instructions[end].name);end++)tails.add(instructions[end].offset);
    const next=instructions[end];if(next)tails.add(next.offset);
    if(!next){fail(prefix,'Instruction prefix requires a following instruction','IL_PREFIX');continue;}
    const chain=instructions.slice(index,end).map(instruction=>instruction.name);
    if(new Set(chain).size!==chain.length)fail(prefix,'Duplicate instruction prefix','IL_PREFIX');
    if(prefix.name==='tail.'&&(!['call','callvirt','calli'].includes(next.name)||instructions[end+1]?.name!=='ret'))fail(prefix,'tail. requires a call immediately followed by ret','IL_PREFIX');
    if(prefix.name==='constrained.') {
      if(next.name!=='callvirt')fail(prefix,'constrained. requires callvirt','IL_PREFIX');
      try{if(inspector.resolveToken(prefix.operand).kind!=='type')throw Error('constrained. requires a type token');}catch(error){fail(prefix,error.message,'IL_TOKEN');}
    }
    if(prefix.name==='unaligned.'&&(![1,2,4].includes(prefix.operand)||!['ldfld','stfld','ldobj','stobj','cpblk','initblk'].includes(next.name)&&!next.name.startsWith('ldind.')&&!next.name.startsWith('stind.')))fail(prefix,'Invalid unaligned memory prefix','IL_PREFIX');
    if(prefix.name==='readonly.'&&next.name!=='ldelema')fail(prefix,'readonly. requires ldelema','IL_PREFIX');
    if(prefix.name==='volatile.'&&!['ldfld','stfld','ldsfld','stsfld','ldobj','stobj','cpblk','initblk'].includes(next.name)&&!next.name.startsWith('ldind.')&&!next.name.startsWith('stind.'))fail(prefix,'volatile. must precede a supported memory instruction','IL_PREFIX');
  }
  for(const [index,handler] of method.handlers.entries()) {
    const filter=handler.flags===1;
    if(![0,1,2,4].includes(handler.flags)||handler.start>=handler.end||handler.target>=handler.handlerEnd||!map.has(handler.start)||!map.has(handler.target)||!boundary(handler.end)||!boundary(handler.handlerEnd))fail(null,'Invalid exception region boundaries');
    if(inside(handler.target,handler.start,handler.end)||inside(handler.start,handler.target,handler.handlerEnd))fail(null,'A clause handler overlaps its protected region');
    if([handler.start,handler.end,handler.target,handler.handlerEnd,...(filter?[handler.catchType]:[])].some(offset=>tails.has(offset)))fail(null,'An exception region cannot split an instruction prefix','IL_PREFIX');
    regions.push({start:handler.start,end:handler.end,kind:'try',key:'try:'+handler.start+':'+handler.end});
    regions.push({start:handler.target,end:handler.handlerEnd,kind:handler.flags===0||filter?'catch':'cleanup',key:'handler:'+index});
    if(filter) {
      if(!map.has(handler.catchType)||handler.catchType>=handler.target||instructions[map.get(handler.target)-1]?.name!=='endfilter')fail(null,'A filter must end with endfilter immediately before its handler');
      regions.push({start:handler.catchType,end:handler.target,kind:'filter',key:'filter:'+index});
    } else if(handler.flags===0)try{if(inspector.resolveToken(handler.catchType).kind!=='type')throw Error('Catch requires a type token');}catch(error){fail(null,error.message,'IL_TOKEN');}
  }
  for(let a=0;a<regions.length;a++)for(let b=a+1;b<regions.length;b++) {
    const first=regions[a],second=regions[b],overlap=first.start<second.end&&second.start<first.end;
    if(overlap&&!(first.start<=second.start&&first.end>=second.end)&&!(second.start<=first.start&&second.end>=first.end))fail(null,'Exception regions must be disjoint or nested');
    if(overlap&&(first.kind==='filter'&&second.start>=first.start&&second.end<=first.end||second.kind==='filter'&&first.start>=second.start&&first.end<=second.end))fail(null,'A filter cannot contain a nested protected region');
  }
  const containing=offset=>regions.filter(region=>inside(offset,region.start,region.end));
  for(const instruction of instructions) {
    const current=containing(instruction.offset),targets=instruction.name==='switch'?instruction.operand:instruction.operandKind.startsWith('br')?[instruction.operand]:[];
    if(['ret','jmp'].includes(instruction.name)&&current.length)fail(instruction,'ret cannot exit a protected region, handler or filter');
    if(instruction.name==='tail.'&&current.length)fail(instruction,'tail. cannot exit a protected region, handler or filter','IL_PREFIX');
    if(instruction.name==='rethrow'&&!current.some(region=>region.kind==='catch'))fail(instruction,'rethrow requires an enclosing catch handler');
    if(instruction.name==='endfinally'&&!current.some(region=>region.kind==='cleanup'))fail(instruction,'endfinally requires a finally or fault handler');
    if(instruction.name==='endfilter'&&!current.some(region=>region.kind==='filter'))fail(instruction,'endfilter requires a filter');
    if(instruction.name.startsWith('leave')&&current.some(region=>region.kind==='filter'||region.kind==='cleanup'&&!inside(instruction.operand,region.start,region.end)))fail(instruction,'leave cannot exit a filter, finally or fault handler');
    for(const target of targets) {
      if(tails.has(target))fail(instruction,'Control flow cannot enter a prefixed instruction after its prefix','IL_PREFIX');
      const destination=containing(target),sourceKeys=new Set(current.map(region=>region.key)),targetKeys=new Set(destination.map(region=>region.key));
      if(destination.some(region=>!sourceKeys.has(region.key))||!instruction.name.startsWith('leave')&&current.some(region=>!targetKeys.has(region.key)))fail(instruction,'Branch crosses an exception region boundary');
    }
  }
}
