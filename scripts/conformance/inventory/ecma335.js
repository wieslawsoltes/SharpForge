import path from 'node:path';
import { compileToIL } from '../../../packages/compiler/src/index.js';
import { CilOpcodes, CilWriter, decodeInstructions, AssemblyInspector, loadAssembly, verifyCilAssembly, isExecutableOpcode, metadataSchemas } from '../../../packages/cil/src/index.js';
import { CilVirtualMachine } from '../../../packages/runtime/src/index.js';
import { inventoryRoot, probeRoot, readJSON, counts } from './common.js';
import { runtimeSource } from './runtime-runner.js';

export function encodingProbe(opcode) {
  const descriptor=CilOpcodes[opcode.name];
  if (!descriptor) return {status:'unsupported',reason:'Opcode is absent from the encoder/decoder table'};
  try {
    const operand=descriptor.operand==='switch'?[0]:descriptor.operand==='i64'?0n:0;
    const bytes=new CilWriter().op(opcode.name,operand).op('ret').finish(), decoded=decodeInstructions(bytes);
    return {status:decoded[0].name===opcode.name && descriptor.value===opcode.value?'pass':'fail',bytes:[...bytes]};
  } catch(error) { return {status:'fail',reason:error.message}; }
}
export async function ecmaInventory() {
  const reference=await readJSON(path.join(inventoryRoot,'references/ecma335.json'));
  const corpus=(await readJSON(path.join(probeRoot,'runtime.json'))).fixtures;
  const observations=[], seen={emitted:new Set(),loaded:new Set(),interpreted:new Set(),verified:new Set()}, tables={emitted:new Set(),loaded:new Set()};
  for(const fixture of corpus) {
    let vm;
    try {
      const c=compileToIL(runtimeSource(fixture));
      if(!c.success) { observations.push({fixture:fixture.id,status:'compile-gap'});continue; }
      const inspector=new AssemblyInspector(c.assembly), names=new Set();
      for(const method of inspector.methods.values()) if(method.hasBody) for(const instruction of inspector.getMethod(method.token).instructions) names.add(instruction.name);
      for(const name of names) seen.emitted.add(name);
      for(let i=0;i<45;i++) if(inspector.metadata.counts[i]) tables.emitted.add(i);
      let loaded=false;try {loadAssembly(c.assembly);loaded=true;for(const name of names)seen.loaded.add(name);for(const n of tables.emitted)if(inspector.metadata.counts[n])tables.loaded.add(n);}catch{}
      const report=verifyCilAssembly(c.assembly); const valid=report.supported ?? report.success ?? report.valid;
      if(valid)for(const token of report.methods)for(const instruction of inspector.getMethod(token).instructions)seen.verified.add(instruction.name);
      const executed=new Set();vm=new CilVirtualMachine(c.assembly,{maxInstructions:200000,virtualTime:true});let slices=0;
      while(['ready','running'].includes(vm.state)&&slices++<1000&&vm.instructions<200000)vm.runSlice({instructionBudget:2000,timeBudgetMs:20,onInstruction:i=>{executed.add(i.name);return false;}});
      const pass=vm.state==='terminated'&&!vm.fault&&vm.output.join('')===fixture.stdout;
      if(pass)for(const name of executed)seen.interpreted.add(name);
      observations.push({fixture:fixture.id,status:pass?'pass':'fail',loaded,verified:!!valid,emitted:[...names].sort(),executed:[...executed].sort(),state:vm.state});
    }catch(error){observations.push({fixture:fixture.id,status:'fail',reason:error.message});}finally{vm?.stop();}
  }
  const rows=reference.opcodes.map(opcode=>{
    const executable=isExecutableOpcode(opcode.name), stages={};
    for(const stage of Object.keys(seen)) stages[stage]=seen[stage].has(opcode.name)?'pass':!executable&&['interpreted','verified'].includes(stage)?'unsupported':'unknown';
    return {key:`ecma:opcode:${opcode.name}`,domain:'CIL',name:opcode.name,area:'A03',specRevision:'ecma-335-6',specSection:opcode.specSection,value:opcode.value,
      status:Object.values(stages).every(x=>x==='pass')?'implemented':Object.values(stages).includes('unsupported')?'unsupported':'unknown',encoding:encodingProbe(opcode),...stages,
      statusScope:'observed in compiler corpus; loaded is canonical SharpForge loader; verified is constrained stack-height profile, not CLR type verification',reason:!executable?'Execution profile explicitly rejects this opcode':'Unobserved stages require a fixture; encoding alone does not qualify execution'};
  });
  for(const table of reference.tables)rows.push({key:`ecma:table:${table.value}`,domain:'CIL',name:table.name,area:'A03',specRevision:'ecma-335-6',specSection:table.specSection,value:table.value,
    status:table.reserved?'unsupported':tables.emitted.has(table.value)?'implemented':'unknown',reserved:table.reserved,schemaPresent:!!metadataSchemas[table.value],emitted:tables.emitted.has(table.value)?'pass':'unknown',loaded:tables.loaded.has(table.value)?'pass':'unknown',interpreted:'unknown',verified:'unknown',
    statusScope:'table row presence only; semantic validation and runtime interpretation remain unqualified',reason:table.reserved?'Reserved or unoptimized/ENC table is not part of the managed profile':'Unobserved table semantics remain unknown'});
  return {schemaVersion:1,reference:{revision:reference.revision,sha256:reference.sourceSHA256},rows,observations,totals:counts(rows)};
}
