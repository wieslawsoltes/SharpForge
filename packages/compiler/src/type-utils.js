import {canonicalType,frameworkAssignable,frameworkType} from '@sharpforge/framework';
/** String-typed type helpers shared by the declaration binder and the method compiler. */
export {numeric} from './numeric.js';
import {numeric, normalizeNumeric, numericDefault, implicitNumeric} from './numeric.js';
import {numericTypeNames, memoryTypeName, arrayType, spanType} from '@sharpforge/bytecode';
export const supported = new Set([...numericTypeNames, 'bool','string','object','void','var','null','error','Exception']);
export const aliases = {'System.Boolean':'bool','System.String':'string','System.Object':'object','System.Void':'void','System.Exception':'Exception'};
export const normalize = type => memoryTypeName(canonicalType(normalizeNumeric(aliases[type] ?? type)));
export function isReference(type) {
  if (spanType(type)) return false;
  return ['string','object','Exception'].includes(type) || !!arrayType(type) ||
    !supported.has(type) && frameworkType(type)?.kind !== 'enum';
}
export function assignable(target, source) {
  const to = spanType(target), from = spanType(source);
  if (to || from) return target === source || !!to?.readonly && to.element === from?.element;
  return frameworkAssignable(target, source) || target === 'error' || source === 'error' || target === source ||
    target === 'object' && source !== 'void' || numeric(target) && numeric(source) && implicitNumeric(source, target) ||
    source === 'null' && isReference(target);
}
export function defaultValue(type) { return numeric(type) ? numericDefault(type) : type === 'bool' ? false : null; }
export function alwaysReturns(s){return (s?.kind==='Using'||s?.kind==='OverflowContext')&&alwaysReturns(s.body)||s?.kind==='Switch'&&s.sections.some(x=>x.labels.includes(null))&&s.sections.every(x=>x.statements.some(alwaysReturns))||s?.kind==='Return'||s?.kind==='Throw'||s?.kind==='Block'&&s.statements.some(alwaysReturns)||s?.kind==='If'&&alwaysReturns(s.then)&&alwaysReturns(s.otherwise)||s?.kind==='Try'&&(alwaysReturns(s.finallyBody)||alwaysReturns(s.body)&&s.catches.every(c=>alwaysReturns(c.body)));}
export function pathOf(e){return e.kind==='Name'?e.name:e.kind==='Member'?`${pathOf(e.target)}.${e.name}`:null;}
/** Display text of a legacy type name in diagnostics: CLR arity markers are dropped (List`1<int> prints as List<int>). */
export function typeText(type){return String(type??'error').replace(/`\d+/g,'');}
/** What CS1674 points at: the whole resource declaration of a using statement (type and declarators), else the resource itself. */
export const usingSpan=(node,resource)=>node.resources?.kind==='Local'?node.resources:resource;
