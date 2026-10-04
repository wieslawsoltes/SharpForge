// Compatibility exports for compiler callers of the declaration conversion seam.
export {supported,aliases,normalize,numeric,isReference,assignable,defaultValue} from './conversions.js';
export function alwaysReturns(s){return (s?.kind==='Using'||s?.kind==='OverflowContext')&&alwaysReturns(s.body)||s?.kind==='Switch'&&s.sections.some(x=>x.labels.includes(null))&&s.sections.every(x=>x.statements.some(alwaysReturns))||s?.kind==='Return'||s?.kind==='Throw'||s?.kind==='Block'&&s.statements.some(alwaysReturns)||s?.kind==='If'&&alwaysReturns(s.then)&&alwaysReturns(s.otherwise)||s?.kind==='Try'&&(alwaysReturns(s.finallyBody)||alwaysReturns(s.body)&&s.catches.every(c=>alwaysReturns(c.body)));}
export function pathOf(e){return e.kind==='Name'?e.name:e.kind==='Member'?`${pathOf(e.target)}.${e.name}`:null;}
/** Display text of a legacy type name in diagnostics: CLR arity markers are dropped (List`1<int> prints as List<int>). */
export function typeText(type){return String(type??'error').replace(/`\d+/g,'');}
/** What CS1674 points at: the whole resource declaration of a using statement (type and declarators), else the resource itself. */
export const usingSpan=(node,resource)=>node.resources?.kind==='Local'?node.resources:resource;
