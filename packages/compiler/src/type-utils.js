import {numericTypeId} from '@sharpforge/bytecode';
import {canonicalType,frameworkAssignable,frameworkType} from '@sharpforge/framework';
/** String-typed type helpers shared by the declaration binder and the method compiler. */
export const supported = new Set(['int','double','bool','string','object','void','var','null','error','Exception']);
export const aliases = { 'System.Int32':'int','System.Double':'double','System.Boolean':'bool','System.String':'string','System.Object':'object','System.Void':'void','System.Exception':'Exception' };
export const normalize = t=>canonicalType(aliases[t]??t);
export const numeric = t=>t==='int'||t==='double';
export const isReference = t=>t==='string'||t==='object'||t==='Exception'||(!supported.has(t)&&t!=='error'&&numericTypeId(t)===undefined&&frameworkType(t)?.kind!=='enum')||t.endsWith('[]');
export function assignable(target,from) { return frameworkAssignable(target,from)||target==='error'||from==='error'||target===from||target==='object'&&from!=='void'||target==='double'&&from==='int'||from==='null'&&isReference(target); }
export function defaultValue(type){return numeric(type)?0:type==='bool'?false:null;}
export function alwaysReturns(s){return (s?.kind==='Using'||s?.kind==='OverflowContext')&&alwaysReturns(s.body)||s?.kind==='Switch'&&s.sections.some(x=>x.labels.includes(null))&&s.sections.every(x=>x.statements.some(alwaysReturns))||s?.kind==='Return'||s?.kind==='Throw'||s?.kind==='Block'&&s.statements.some(alwaysReturns)||s?.kind==='If'&&alwaysReturns(s.then)&&alwaysReturns(s.otherwise)||s?.kind==='Try'&&(alwaysReturns(s.finallyBody)||alwaysReturns(s.body)&&s.catches.every(c=>alwaysReturns(c.body)));}
export function pathOf(e){return e.kind==='Name'?e.name:e.kind==='Member'?`${pathOf(e.target)}.${e.name}`:null;}
/** Display text of a legacy type name in diagnostics: CLR arity markers are dropped (List`1<int> prints as List<int>). */
export function typeText(type){return String(type??'error').replace(/`\d+/g,'');}
/** What CS1674 points at: the whole resource declaration of a using statement (type and declarators), else the resource itself. */
export const usingSpan=(node,resource)=>node.resources?.kind==='Local'?node.resources:resource;
