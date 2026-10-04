import {numericTypeId} from '@sharpforge/bytecode';
import {canonicalType,frameworkAssignable,frameworkType} from '@sharpforge/framework';
/** String-typed type helpers shared by the declaration binder and the method compiler. */
export const supported = new Set(['int','double','bool','string','object','void','var','null','error','Exception']);
export const aliases = { 'System.Int32':'int','System.Double':'double','System.Boolean':'bool','System.String':'string','System.Object':'object','System.Void':'void','System.Exception':'Exception' };
export const normalize = t=>canonicalType(aliases[t]??t);
export const numeric = t=>t==='int'||t==='double';
export const isReference = t=>t==='string'||t==='object'||t==='Exception'||(!supported.has(t)&&t!=='error'&&numericTypeId(t)===undefined&&frameworkType(t)?.kind!=='enum')||t.endsWith('[]');
export function assignable(target,from) { return frameworkAssignable(target,from)||target==='error'||from==='error'||target===from||target==='object'&&from!=='void'||target==='double'&&from==='int'||from==='null'&&isReference(target); }
export function defaultValue(type){return numeric(type)||type==='float'||type==='uint'?0:type==='bool'?false:null;}
