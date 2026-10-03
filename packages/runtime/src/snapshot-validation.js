/** Validate every component before a restore can replace live execution state. */
export function validateSnapshotState(vm,s,engine) {
  const fail=part=>{throw new TypeError('Invalid snapshot '+part);};
  const integer=value=>Number.isSafeInteger(value)&&value>=0;
  const pairs=(values,part)=>{
    if(!Array.isArray(values)||values.some(row=>!Array.isArray(row)||row.length!==2))fail(part);
    if(new Set(values.map(row=>row[0])).size!==values.length)fail(part+' keys');
  };
  const frames=(values)=>{
    if(!Array.isArray(values))fail('frames');
    const ids=new Set();
    for(const frame of values) {
      if(!frame||!integer(frame.id)||frame.id===0||ids.has(frame.id)||!integer(frame.pc)||!Array.isArray(frame.locals))fail('frame');
      ids.add(frame.id);
      if(engine==='cil') {
        if(!frame.method||!Array.isArray(frame.method.instructions)||!Array.isArray(frame.args)||!Array.isArray(frame.stack)||frame.pc>frame.method.instructions.length)fail('CIL frame');
        let original;try{original=vm.inspector.getMethod(frame.method.token);}catch{fail('method identity');}
        if(original.instructions!==frame.method.instructions)fail('method code generation');
      } else {
        const method=vm.image.methods[frame.methodId];
        if(!method||frame.pc>method.code.length/3||!integer(frame.base))fail('source frame');
      }
    }
  };
  frames(s.frames);
  if(!Array.isArray(s.output)||s.output.some(value=>typeof value!=='string')||!integer(s.instructions)||!integer(s.frameId)||!integer(s.outputCharacters)||!Number.isFinite(s.elapsedMs)||s.elapsedMs<0||!['ready','running','paused','waiting','terminated','faulted'].includes(s.state))fail('execution state');
  if(engine==='source'&&(!Array.isArray(s.stack)||!Array.isArray(s.statics)||!Array.isArray(s.constantValues)))fail('source storage');
  if(engine==='cil'&&(!(s.statics instanceof Map)||!(s.initialized instanceof Map)))fail('CIL storage');
  if(!(s.strings instanceof Map)||s.typeObjects!==undefined&&!(s.typeObjects instanceof Map))fail('type/string caches');
  const heap=s.heap;
  if(!heap||!Array.isArray(heap.records)||!Array.isArray(heap.generations)||heap.generations.length<heap.records.length||!Array.isArray(heap.free)||!heap.stats||!integer(heap.generationCounter)||!Number.isFinite(heap.threshold)||heap.threshold<0)fail('heap');
  pairs(heap.handles??[],'heap handles');
  const free=new Set();
  for(const index of heap.free) {
    if(!integer(index)||index>=heap.records.length||heap.records[index]!==null||free.has(index))fail('heap free list');
    free.add(index);
  }
  for(const [index,record] of heap.records.entries()) {
    if(record===null)continue;
    if(!record||typeof record.kind!=='string'||typeof record.type!=='string'||!integer(record.size)||!integer(heap.generations[index])||heap.generations[index]===0||heap.generations[index]>heap.generationCounter)fail('heap record');
    if(record.kind==='string'?typeof record.data!=='string':!Array.isArray(record.data))fail('heap data');
    if(record.methodTable?.registry!==vm.heap.methodTables)fail('heap type identity');
  }
  const scheduler=s.scheduler;
  if(scheduler!==null) {
    if(!scheduler||!integer(scheduler.currentId)||!integer(scheduler.nextId)||!integer(scheduler.nextTaskId)||!Number.isFinite(scheduler.clock)||scheduler.clock<0||!integer(scheduler.turn)||!integer(scheduler.steps))fail('scheduler');
    pairs(scheduler.contexts,'scheduler contexts');pairs(scheduler.tasks,'scheduler tasks');
    const contextIds=new Set(),parkedFrameIds=new Set();
    for(const [id,context] of scheduler.contexts) {
      if(!integer(id)||id===0||context.id!==id||!['ready','running','waiting','completed','faulted','canceled'].includes(context.status))fail('context');
      contextIds.add(id);frames(context.frames);
      for(const frame of context.frames){if(parkedFrameIds.has(frame.id))fail('duplicate frame identity');parkedFrameIds.add(frame.id);}
      if(context.stack!==undefined&&!Array.isArray(context.stack))fail('context stack');
    }
    if(!contextIds.has(scheduler.currentId))fail('current context');
    for(const [,task] of scheduler.tasks)if(!task||!Array.isArray(task.waiters)||task.dependencies!==null&&task.dependencies!==undefined&&!Array.isArray(task.dependencies))fail('task');
  }
  const platform=s.platform;
  if(!platform||!integer(platform.sequence)||!platform.animations)fail('platform');
  pairs(platform.windows,'platform windows');pairs(platform.singletons??[],'platform singletons');
  const animations=platform.animations;
  if(!Array.isArray(animations.states)||!Array.isArray(animations.bases))fail('animation state');
}
