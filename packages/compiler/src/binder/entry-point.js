import {DiagnosticId} from '../diagnostics/codes.js';
import {taskResult} from '@sharpforge/framework';
/**
 * Entry-point selection.
 *
 * A program starts at its top-level statements (C# 9) or at a static method named Main whose signature is
 * `static void|int|Task|Task<int> Main()` or `Main(string[] args)`; Task-returning (async) Main is a C# 7.1 feature.
 * Diagnostics follow Roslyn:
 *   CS5001  no suitable Main and no top-level statements (error)
 *   CS0017  more than one suitable Main (error, on the first in source order)
 *   CS0028  a method named Main with the wrong signature (warning)
 *   CS0402  a generic Main or a Main in a generic type (warning; not expressible in the current syntax)
 *   CS7022  a Main that is ignored because the program has top-level statements (warning)
 *   CS8892  an async Main that is ignored because a synchronous Main exists (warning)
 *   CS8802  top-level statements in more than one file (error), CS8805 in a library (error)
 *   CS1555 / CS1558  the type named by the main-type option is missing / has no suitable Main (error)
 * Libraries have no entry point and report nothing about Main.
 */
const display=m=>m.qualifiedName+'('+m.parameters.map(p=>p.type).join(', ')+')';
/** Classifies a Main candidate: `{valid, isAsync, returnsInt}`. */
export function entryPointSignature(method){
  const awaited=taskResult(method.returnType),result=awaited??method.returnType,isAsync=awaited!==null;
  const valid=['void','int'].includes(result)&&(method.parameters.length===0||method.parameters.length===1&&method.parameters[0].type==='string[]');
  return {valid,isAsync,returnsInt:result==='int'};
}
/**
 * @param {object} input `methods`: every declared method record; `topLevel`: `[{file,statements}]` for files that have
 *   top-level statements; `isLibrary`; `mainTypeName` (optional); `asyncMainAvailable(node)`: language-version check
 *   for async Main (reports the feature diagnostic itself and returns false below C# 7.1).
 * @returns `{kind:'topLevel'|'main'|null, method, topLevel, diagnostics:[{node,code,args}]}` where `method` is the
 *   selected Main record (kind 'main') and `topLevel` the selected `{file,statements}` (kind 'topLevel').
 */
export function findEntryPoint({methods,topLevel=[],isLibrary=false,mainTypeName=null,types=[],asyncMainAvailable=()=>true,root=null}){
  const diagnostics=[],report=(node,code,args=[])=>diagnostics.push({node:node??root,code,args});
  if(topLevel.length>1)report(topLevel[1].file.root,DiagnosticId.CS8802);
  if(isLibrary){if(topLevel.length)report(topLevel[0].file.root,DiagnosticId.CS8805);return {kind:null,method:null,topLevel:null,diagnostics};}
  let candidates=methods.filter(m=>m.name==='Main'&&m.isStatic&&!m.synthetic);
  if(topLevel.length){for(const m of candidates)report(m.node,DiagnosticId.CS7022,[display(m)]);return {kind:'topLevel',method:null,topLevel:topLevel[0],diagnostics};}
  if(mainTypeName){
    const type=types.find(t=>t.fullName===mainTypeName||t.name===mainTypeName);if(!type){report(null,DiagnosticId.CS1555,[mainTypeName]);return {kind:null,method:null,topLevel:null,diagnostics};}
    candidates=candidates.filter(m=>m.owner===type);
    if(!candidates.some(m=>entryPointSignature(m).valid)){report(type.node,DiagnosticId.CS1558,[type.fullName??type.name]);return {kind:null,method:null,topLevel:null,diagnostics};}
  }
  const viable=[];
  for(const m of candidates){const signature=entryPointSignature(m);if(!signature.valid){report(m.node,DiagnosticId.CS0028,[display(m)]);continue;}if(signature.isAsync&&!asyncMainAvailable(m.node))continue;viable.push({method:m,...signature});}
  // A synchronous Main wins over async ones, which are then reported as unused.
  let chosen=viable;const synchronous=viable.filter(v=>!v.isAsync);
  if(synchronous.length&&synchronous.length<viable.length){for(const v of viable)if(v.isAsync)report(v.method.node,DiagnosticId.CS8892,[display(v.method),display(synchronous[0].method)]);chosen=synchronous;}
  if(!chosen.length){report(null,DiagnosticId.CS5001);return {kind:null,method:null,topLevel:null,diagnostics};}
  if(chosen.length>1){const ordered=[...chosen].sort((a,b)=>String(a.method.node.uri).localeCompare(String(b.method.node.uri))||a.method.node.start-b.method.node.start);report(ordered[0].method.node,DiagnosticId.CS0017);return {kind:'main',method:ordered[0].method,topLevel:null,diagnostics};}
  return {kind:'main',method:chosen[0].method,topLevel:null,diagnostics};
}
