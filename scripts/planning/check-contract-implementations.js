import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {contracts,frameworkType} from '@sharpforge/framework';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine,ManagedFault} from '@sharpforge/runtime';
import {frameworkBuiltin} from '@sharpforge/bytecode';
import {contractForMember} from '@sharpforge/framework';
export function implementationStatus(source,cil){return source&&cil?'implemented':source?'source-only':cil?'cil-only':'missing';}
export function checkImplementationRegression(previous,current){
  const byId=new Map(current.contracts.map(row=>[row.id,row]));
  for(const row of previous.contracts){const next=byId.get(row.id);if(!next||row.source.handled&&!next.source.handled||row.cil.handled&&!next.cil.handled)throw new Error('Contract implementation regressed at id '+row.id);}
  const oldIds=new Set(previous.contracts.map(row=>row.id));for(const row of current.contracts)if(!oldIds.has(row.id)&&(!row.source.handled||!row.cil.handled))throw new Error('New contract lacks both engine handlers at id '+row.id);
  return true;
}
/** Executes the real managed dispatcher in a fresh VM. Argument faults prove only that
 * a registered handler was reached; unsupported/host JS failures remain unqualified. */
export function probeContract(vm,d){
  const p=vm.platform,constructing=new Set();
  function methodPointer(type){
    const t=frameworkType(type),name=t.parameters?.length===2?'Routed':({void:'Empty',int:'Int',double:'Double',bool:'Bool',string:'Text',object:'Object','double[]':'Array','System.Net.Http.HttpResponseMessage':'Response'})[t.result];
    const method=vm.inspector?[...vm.inspector.methods.values()].find(m=>m.name===name):vm.image.methods.find(m=>m.name===name);
    if(!method)throw new Error('No verified probe callback for '+type);
    return vm.inspector?method.token:method.id;
  }
  function value(type){
    if(type==='string'||type==='System.String')return vm.heap.string('0');
    if(type==='bool')return p.managed(false,'bool');
    // Int64 stack/storage values use BigInt in both engines; host Number is not a valid UInt64 fixture.
    if (type === 'long' || type === 'ulong') return 0n;
    if(type.endsWith('[]'))return vm.heap.allocate('array',type,[]);
    const t=frameworkType(type);if(!t)return type==='object'?null:p.managed(0,type);
    if(t.kind==='enum')return Object.values(t.values)[0]??0;
    if(t.kind==='delegate')return p.delegate(type,methodPointer(type),null);
    if(type==='Microsoft.UI.Xaml.Media.Animation.EasingFunctionBase')return p.construct('Microsoft.UI.Xaml.Media.Animation.QuadraticEase',[]);
    if(constructing.has(type))return null;
    constructing.add(type);
    try{const ctor=contracts.filter(c=>c.owner===type&&c.kind==='constructor').sort((a,b)=>a.parameters.length-b.parameters.length)[0];if(ctor)try{return p.invoke(ctor,ctor.parameters.map(value));}catch{}return p.make(type,{},t.kind==='collection'?'collection':t.kind==='delegate'?'delegate':'host');}
    finally{constructing.delete(type);}
  }
  try{
    const binding=vm.inspector?contractForMember({owner:d.owner,name:d.name,signature:{isStatic:d.isStatic,parameters:d.parameters,returnType:d.kind==='constructor'?'void':d.result}}):frameworkBuiltin(d)?.contract;
    if(binding?.id!==d.id)return {handled:false,outcome:'unbound'};
    const args=d.parameters.map(value);if(d.kind==='constructor'&&frameworkType(d.owner)?.kind==='delegate')args[1]={methodPointer:true,token:methodPointer(d.owner)};if(!d.isStatic&&d.kind!=='constructor')args.unshift(value(d.owner));
    try{p.invoke(d,args);return {handled:true,outcome:'returned'};}
    catch(error){return {handled:error instanceof ManagedFault&&!['MissingMethodException','TypeLoadException','InvalidProgramException'].includes(error.name),outcome:error.name,message:error.message};}
  }catch(error){return {handled:false,outcome:'fixture-unavailable',message:error.message};}
  finally{vm.stop();}
}
export function inspectContractImplementations(){
  const compiled=compileToIL('class Program { static void Main() {} static void Empty() {} static void Routed(object sender, Microsoft.UI.Xaml.RoutedEventArgs args) {} static int Int(){return 0;} static double Double(){return 0.0;} static bool Bool(){return false;} static string Text(){return null;} static object Object(){return null;} static double[] Array(){return null;} static System.Net.Http.HttpResponseMessage Response(){return null;} }');if(!compiled.success)throw new Error('Could not compile dispatch probe');
  const rows=contracts.map(d=>{const source=probeContract(new VirtualMachine(compiled.image,{network:{enabled:false},compute:{workers:1}}),d),cil=probeContract(new CilVirtualMachine(compiled.assembly,{network:{enabled:false},compute:{workers:1}}),d);return {id:d.id,owner:d.owner,name:d.name,parameters:d.parameters,status:implementationStatus(source.handled,cil.handled),source,cil};});
  return {version:1,qualification:'JavaScript dispatcher reachability only; returned/managed argument faults are handler evidence. Missing includes inconclusive fixtures. Not native CLR or WinUI qualification.',targets:['source-vm','cil-vm'],contracts:rows};
}
export async function implementationsMain(args=process.argv.slice(2)){
  const path=new URL('../../planning/contracts/contract-implementations.json',import.meta.url),current=inspectContractImplementations();
  if(args.includes('--write'))await writeFile(path,JSON.stringify(current,null,2)+'\n');
  else checkImplementationRegression(JSON.parse(await readFile(path,'utf8')),current);
  console.log(Object.fromEntries(['implemented','source-only','cil-only','missing'].map(status=>[status,current.contracts.filter(row=>row.status===status).length])));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await implementationsMain();
