import {boundNodeFields} from './nodes.js';
/**
 * A stable, readable text dump of a bound tree, one node per line:
 *
 *   BinaryOperator operator=+ isChecked=false : int
 *     Local local=a : int
 *     Literal value=1 : int = 1
 *
 * Value fields are rendered by what they are (symbols by display name, locals as name:type, constants as JSON);
 * expressions end with `: type` and `= constant` when they have a constant value; `!` marks nodes with errors.
 * Used by snapshot tests and for debugging the binder and the lowering passes.
 */
function describe(value){
  if(value===null||value===undefined)return null;
  if(Array.isArray(value))return '['+value.map(v=>describe(v)??'null').join(', ')+']';
  if(typeof value==='object'){
    if(value.kind==='Local')return value.name+':'+(value.type?value.type.toDisplayString():'null');
    if(value.kind==='Parameter')return value.name;
    if(typeof value.toDisplayString==='function')return value.toDisplayString();
    if(value.name!==undefined&&value.id!==undefined)return String(value.name);
    return JSON.stringify(value);
  }
  return typeof value==='string'?JSON.stringify(value):String(value);
}
/** @returns the dump as an array of lines. */
export function dumpBoundTreeLines(node,indent=''){
  if(!node)return [];const fields=boundNodeFields[node.kind]??[],parts=[node.kind];
  for(const [name,kind] of fields){if(kind!=='value')continue;const text=describe(node[name]);if(text!==null&&text!=='[]')parts.push(name+'='+text);}
  if(node.isExpression){parts.push(': '+(node.type?node.type.toDisplayString():node.legacyType==='null'?'<null>':'?'));if(node.constantValue)parts.push('= '+JSON.stringify(node.constantValue.value));}
  if(node.hasErrors)parts.push('!');
  const lines=[indent+parts.join(' ')];for(const child of node.children)lines.push(...dumpBoundTreeLines(child,indent+'  '));return lines;
}
/** @returns the dump as one string. */
export function dumpBoundTree(node){return dumpBoundTreeLines(node).join('\n');}
