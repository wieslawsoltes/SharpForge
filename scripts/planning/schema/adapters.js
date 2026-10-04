import {lowerMethodBody,IR_OPERATIONS,mergeType,stackType} from './lower-method-body.js';
import {canonicalType} from '../../../packages/framework/src/index.js';
import {SchemaError} from './validate.js';
const aliases={void:'System.Void',bool:'System.Boolean',char:'System.Char',sbyte:'System.SByte',byte:'System.Byte',short:'System.Int16',ushort:'System.UInt16',int:'System.Int32',uint:'System.UInt32',long:'System.Int64',ulong:'System.UInt64',nint:'System.IntPtr',nuint:'System.UIntPtr',float:'System.Single',double:'System.Double',decimal:'System.Decimal',string:'System.String',object:'System.Object'};
function splitArguments(text){
  const delimiters=[],result=[];let start=0;
  for(let i=0;i<text.length;i++){
    const character=text[i];
    if(character==='<'||character==='[')delimiters.push(character);
    else if(character==='>'||character===']'){
      if(delimiters.pop()!==(character==='>'?'<':'['))throw new SchemaError('SCHEMA_INVALID','Unbalanced generic type');
    }else if(character===','&&!delimiters.length){result.push(text.slice(start,i).trim());start=i+1;}
  }
  if(delimiters.length)throw new SchemaError('SCHEMA_INVALID','Unbalanced generic type');
  result.push(text.slice(start).trim());return result;
}
export function typeIdentity(text,assembly='SharpForge'){
  if(typeof text!=='string'||!text.trim())throw new SchemaError('SCHEMA_INVALID','Type name required');
  text=text.trim();
  const suffix=text.match(/(\[(,*)\]|[&*])$/);
  if(suffix)return {kind:suffix[1][0]==='['?'array':suffix[1]==='&'?'byref':'pointer',element:typeIdentity(text.slice(0,-suffix[1].length),assembly),rank:suffix[2]===undefined?1:suffix[2].length+1};
  const parameter=/^(!{1,2})(\d+)$/.exec(text);
  if(parameter)return {kind:'parameter',owner:parameter[1]==='!!'?'method':'type',index:Number(parameter[2])};
  const at=text.indexOf('<');let args=[],name=text,arity;
  if(at>=0){
    if(!text.endsWith('>'))throw new SchemaError('SCHEMA_INVALID','Unbalanced generic type');
    name=text.slice(0,at).trim();
    if(!name||/[>\[\]]/.test(name))throw new SchemaError('SCHEMA_INVALID','Invalid generic type name');
    const argumentsText=splitArguments(text.slice(at+1,-1));
    arity=Number(/`(\d+)$/.exec(name)?.[1]??argumentsText.length);
    if(arity!==argumentsText.length)throw new SchemaError('SCHEMA_INVALID','Generic arity mismatch');
    args=argumentsText.map(argument=>typeIdentity(argument,assembly));
    // Resolve framework aliases with scalar placeholders: its legacy comma splitter
    // must not reinterpret commas in the original nested arguments or array ranks.
    const canonical=canonicalType(name+'<'+argumentsText.map(()=>'object').join(',')+'>');
    name=canonicalType(canonical.slice(0,canonical.indexOf('<'))).replace(/`\d+$/,'');
    name=aliases[name]??name;
    if(arity)name+='`'+arity;
  }else{
    if(/[>\[\]]/.test(text))throw new SchemaError('SCHEMA_INVALID','Unbalanced type delimiters');
    name=canonicalType(text);name=aliases[name]??name;
    arity=Number(/`(\d+)$/.exec(name)?.[1]??0);
  }
  return {kind:'named',assembly:name.startsWith('System.')?'System.Runtime':assembly,name,arity,arguments:args};
}
export function validateTypeSemantics(type){if(['byref','pointer'].includes(type.kind)&&type.rank!==1)throw new SchemaError('SCHEMA_INVALID','Byref/pointer rank must be one');if(type.kind==='named'){if(type.arguments.length&&type.arguments.length!==type.arity)throw new SchemaError('SCHEMA_INVALID','Generic argument count');type.arguments.forEach(validateTypeSemantics);}else if(type.element)validateTypeSemantics(type.element);else if(type.kind==='functionPointer')validateSignature(type.signature);if(type.modifier)validateTypeSemantics(type.modifier);return type;}
export function validateSignature(s){if(s.explicitThis&&!s.hasThis||s.sentinel!==null&&(s.callingConvention!=='vararg'||s.sentinel>s.parameters.length))throw new SchemaError('SCHEMA_INVALID','Invalid signature convention');validateTypeSemantics(s.returnType);s.parameters.forEach(validateTypeSemantics);return s;}
export function sourceSpan(point,source,documentId=point.uri??String(point.document??'')){
  const hidden=!!point.hidden||point.startLine===0xfeefee;const position=offset=>{const prefix=source?.slice(0,offset);if(prefix===undefined)return null;const lines=prefix.split(/\r\n|\r|\n/);return {line:lines.length,column:lines.at(-1).length+1};};
  const offsetAt=(line,column)=>{if(source===undefined)return null;let start=0,current=1;for(const match of source.matchAll(/\r\n|\r|\n/g)){if(current++===line)break;start=match.index+match[0].length;}return start+column-1;};
  const start=hidden?null:point.start??offsetAt(point.startLine,point.startColumn),end=hidden?null:point.end??offsetAt(point.endLine,point.endColumn),a=position(start),b=position(end);
  return {schemaVersion:1,documentId,offset:point.ilOffset??point.offset,hidden,start,end,startLine:hidden?0:point.startLine??a?.line??point.line,startColumn:hidden?0:point.startColumn??a?.column??point.column,endLine:hidden?0:point.endLine??b?.line??point.line,endColumn:hidden?0:point.endColumn??b?.column??point.column};
}
export function validateSpan(span){if(span.hidden){if(span.start!==null||span.end!==null||[span.startLine,span.startColumn,span.endLine,span.endColumn].some(x=>x!==0))throw new SchemaError('SCHEMA_INVALID','Hidden span has visible coordinates');}else if(span.start!==null&&span.end!==null&&span.start>span.end||span.startLine<1||span.startColumn<1||span.endLine<span.startLine||span.endLine===span.startLine&&span.endColumn<span.startColumn)throw new SchemaError('SCHEMA_INVALID','Reversed or invalid span');return span;}
export function methodBody(method,encoding,context={}) { return lowerMethodBody(method,encoding,context); }
export function validateBody(body,{requireExecutable=false}={}){
  const validType=t=>typeof t==='string'&&/^(i32|i64|nativeint|f32|f64|void|null|ref:.+|byref:.+|pointer:.+)$/.test(t);
  if(requireExecutable&&(body.typeState!=='resolved'||body.instructions.some(i=>!validType(i.resultType)||!Array.isArray(i.outputTypes)||[...i.inputTypes,...i.outputTypes,...i.stackIn,...i.stackOut].some(t=>!validType(t)||t==='void'))))throw new SchemaError('SCHEMA_UNRESOLVED','Instruction typing is unresolved; executable typed IR required');
  const n=body.instructions.length,invalid=message=>{throw new SchemaError('SCHEMA_INVALID',message);};
  if(!n||body.instructions.some((i,index)=>i.offset!==index))invalid('Noncontiguous or empty instruction stream');
  for(const r of body.exceptionRegions)if(r.start>=r.end||r.end>n||r.handlerStart>=r.handlerEnd||r.handlerEnd>n||r.filterStart!==null&&r.filterStart>=n)invalid('Invalid exception region boundary');
  for(const s of body.safepoints)if(s.offset>=n)invalid('Invalid safepoint offset');
  if(body.typeState!=='resolved')return body;
  if(body.instructions[0].stackIn.length)invalid('Method entry stack must be empty');
  if(body.localStorageTypes?.length!==body.locals.length||body.parameterStorageTypes?.length!==body.parameters.length)invalid('Storage signature lengths differ');
  if(body.locals.some((type,index)=>stackType(body.localStorageTypes[index])!==type)||body.parameters.some((type,index)=>stackType(body.parameterStorageTypes[index])!==type)||stackType(body.returnStorageType)!==body.returnType)invalid('Storage and stack signature types differ');
  if(!validType(body.returnType)||[...body.locals,...body.parameters].some(t=>!validType(t)||t==='void'))invalid('Malformed body signature');
  for(const i of body.instructions){
    if(!IR_OPERATIONS.includes(i.opcode))invalid('Unknown normalized operation');
    if(i.inputTypes.length>i.stackIn.length||JSON.stringify(i.stackIn.slice(i.stackIn.length-i.inputTypes.length))!==JSON.stringify(i.inputTypes))invalid('Instruction inputs differ from its stack');
    const expected=[...i.stackIn.slice(0,i.stackIn.length-i.inputTypes.length),...i.outputTypes];
    if(JSON.stringify(expected)!==JSON.stringify(i.stackOut)||i.resultType!==(i.outputTypes.at(-1)??'void'))invalid('Instruction output stack differs from its typed effect');
    if(i.opcode==='return'){
      const policy=i.operands?.[0];
      if(!Array.isArray(i.operands)||i.operands.length!==1||!policy||typeof policy!=='object'||Array.isArray(policy)||
        Object.keys(policy).length!==1||!Object.hasOwn(policy,'discardPadding')||typeof policy.discardPadding!=='boolean')invalid('Return must declare explicit void padding');
      if(i.inputTypes.length!==i.stackIn.length||i.outputTypes.length||i.stackOut.length)invalid('Return must consume the complete stack without outputs');
      // Padding is an explicit semantic operand; provenance does not choose the return convention.
      const count=body.returnType==='void'&&!policy.discardPadding?0:1;
      if(i.inputTypes.length!==count)invalid('Return arity differs from its signature and padding');
      if(policy.discardPadding&&(body.returnType!=='void'||i.inputTypes[0]!=='null'))invalid('Return padding must be one null value for a void method');
    }
    for(const target of i.successors){if(!Number.isInteger(target)||target<0||target>=n)invalid('Branch target is outside the instruction stream');const joined=body.instructions[target].stackIn;if(joined.length!==i.stackOut.length)invalid('Stack height conflict at branch target');for(let slot=0;slot<joined.length;slot++)if(mergeType(i.stackOut[slot],joined[slot])!==joined[slot])invalid('Type conflict at branch target');}
    const expectedSuccessors=['branch','leave'].includes(i.opcode)?[i.operands[0]]:i.opcode==='branch-if'?[i.operands[0],i.offset+1]:i.opcode==='compare-branch'?[i.operands[1],i.offset+1]:i.opcode==='switch'&&Array.isArray(i.operands[0])?[...i.operands[0],i.offset+1]:['return','throw','rethrow','end-finally'].includes(i.opcode)?[]:[i.offset+1];
    if(JSON.stringify(i.successors)!==JSON.stringify(expectedSuccessors))invalid('Operation and control-flow successors differ');
    if(i.opcode==='load-local'&&i.resultType!==body.locals[i.operands[0]])invalid('Local load type differs from declared local');
    if(i.opcode==='load-argument'&&i.resultType!==body.parameters[i.operands[0]])invalid('Argument load type differs from signature');
    if(i.opcode==='local-address'||i.opcode==='argument-address'){
      const slots=i.opcode==='local-address'?body.locals:body.parameters,slot=i.operands?.[0];
      if(!Array.isArray(i.operands)||i.operands.length!==1||!Number.isInteger(slot)||slot<0||slot>=slots.length)invalid('Address operand must name one declared slot');
      if(i.inputTypes.length||i.outputTypes.length!==1||i.outputTypes[0]!=='byref:'+slots[slot])invalid('Address effect differs from its declared slot');
    }
  }
  const max=body.instructions.reduce((value,i)=>Math.max(value,i.stackIn.length,i.stackOut.length),0);if(body.maxStack!==max)invalid('Maximum stack differs from typed stream');
  for(const region of body.exceptionRegions){const stack=body.instructions[region.handlerStart].stackIn,expected=body.encoding==='cil'&&region.kind==='catch'?[region.catchType]:[];if(JSON.stringify(stack)!==JSON.stringify(expected))invalid('Exception handler entry stack is invalid');}
  return body;
}
export function snapshotRecord(vm){const s=vm.snapshot();return {schemaVersion:1,engine:vm.inspector?'cil':'source',state:s.state,instructions:s.instructions,frameId:s.frameId,hostRevision:s.hostRevision,frames:s.frames.map(f=>({id:f.id,methodId:f.method?.token??f.methodId,pc:f.pc,localCount:f.locals.length,argumentCount:f.args?.length??0,stackCount:f.stack?.length??s.stack?.length??0})),heap:{generationCounter:s.heap.generationCounter,liveObjects:s.heap.stats.liveObjects,liveBytes:s.heap.stats.liveBytes},pendingFault:s.pendingFault?.name??null,fault:s.fault?.name??null,output:s.output};}
export function faultRecord(vm,fault=vm.fault){if(!fault)throw new SchemaError('SCHEMA_INVALID','Fault required');const ref=r=>r?{h:r.h+1,g:r.g}:null;let message=null;if(fault.reference){const r=vm.heap.get(fault.reference);message=r.data?.[0];}return {schemaVersion:1,typeToken:'T:'+fault.name,messageHandle:ref(message),exceptionHandle:ref(fault.reference),frames:(fault.frames??[]).map(f=>({method:f.method,offset:f.ilOffset??f.point?.offset??null})),uncatchable:vm.inspector?['InstructionLimitException','OutputLimitException','StackOverflowException','ExecutionLimitException'].includes(fault.name):fault.name==='InstructionLimitException',cause:fault.cause?faultRecord(vm,fault.cause):null};}
export function symbolId(declaration){const d=declaration,escape=s=>encodeURIComponent(s).replace(/\./g,'%2E');if(d.kind==='namespace')return 'N:'+d.name;if(d.kind==='type')return 'T:'+d.name;if(['local','lambda','localFunction'].includes(d.kind)){if(!Number.isInteger(d.ordinal)||d.ordinal<0||!d.parent||!d.document)throw new SchemaError('SCHEMA_INVALID','Scoped identity requires document and ordinal');return `X:${d.kind}:${escape(d.parent)}:${escape(d.document)}:${d.ordinal}:${escape(d.name??'')}`;}if(!['method','field','property','event'].includes(d.kind))throw new SchemaError('SCHEMA_INVALID','Unknown declaration kind');return {method:'M',field:'F',property:'P',event:'E'}[d.kind]+':'+d.owner+'.'+d.name.replace(/\./g,'#')+(d.genericArity?'``'+d.genericArity:'')+(['method','property'].includes(d.kind)?'('+(d.parameters??[]).join(',')+')':'');}
export class SymbolTable {constructor(declarations){this.byId=new Map();this.byToken=new Map();for(const d of declarations){const id=symbolId(d);if(this.byId.has(id))throw new SchemaError('SCHEMA_INVALID','Duplicate symbol identity');this.byId.set(id,d);if(d.token!==undefined){const key=`${d.module}:${d.token}`;if(this.byToken.has(key))throw new SchemaError('SCHEMA_INVALID','Duplicate metadata token');this.byToken.set(key,id);}}}resolve(id){if(!this.byId.has(id))throw new SchemaError('SCHEMA_INVALID','Unresolved symbol');return this.byId.get(id);}fromToken(module,token){const id=this.byToken.get(`${module}:${token}`);if(!id)throw new SchemaError('SCHEMA_INVALID','Unresolved metadata token');return id;}}
