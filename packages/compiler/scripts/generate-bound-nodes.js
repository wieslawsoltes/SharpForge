#!/usr/bin/env node
/** Generates src/bound/nodes.js, visitor.js and rewriter.js from src/bound/nodes.json.
 * `--check` exits non-zero when a generated file is stale instead of writing it.
 */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=resolve(dirname(fileURLToPath(import.meta.url)),'../src/bound'),spec=JSON.parse(readFileSync(join(dir,'nodes.json'),'utf8'));
const banner='/** GENERATED from bound/nodes.json by packages/compiler/scripts/generate-bound-nodes.js. Do not edit. */\n';
const all=[...spec.expressions.map(n=>({...n,expression:true})),...spec.statements.map(n=>({...n,expression:false}))];
for(const n of all)for(const [name,kind] of n.fields){if(!['node','node?','nodes','value'].includes(kind))throw new Error(`${n.name}.${name}: unknown field kind ${kind}`);if(['kind','syntax','type','legacyType','constantValue','hasErrors'].includes(name))throw new Error(`${n.name}.${name} collides with a base field`);}
if(new Set(all.map(n=>n.name)).size!==all.length)throw new Error('Duplicate node name');
const children=n=>n.fields.filter(([,k])=>k!=='value');
let nodes=banner+`/**
 * The bound tree: the semantic form of method bodies produced by the binder and consumed by flow analysis,
 * lowering and code generation. Nodes are immutable; \`update\` returns the same node when nothing changed.
 *
 * Every node has \`kind\`, \`syntax\` (the syntax node it was bound from, or null for synthesized nodes) and \`hasErrors\`.
 * Expressions also have \`type\` (a TypeSymbol; null for the null literal and for typeless expressions),
 * \`constantValue\` ({value} when the expression is a compile-time constant, else null) and \`legacyType\`
 * (the string type name the string-typed bytecode back end exchanges).
 */
export const BoundKind=Object.freeze({${all.map(n=>`${n.name}:'${n.name}'`).join(',')}});
const anyErrors=list=>{for(const x of list){if(Array.isArray(x)){if(anyErrors(x))return true;}else if(x&&x.hasErrors)return true;}return false;};
export class BoundNode {
  constructor(kind,syntax,hasErrors){this.kind=kind;this.syntax=syntax??null;this.hasErrors=!!hasErrors;}
  /** Child nodes in evaluation order. */
  get children(){return [];}
  accept(visitor,argument){return visitor.visitDefault(this,argument);}
}
export class BoundExpression extends BoundNode {
  constructor(kind,syntax,type,options,childErrors){super(kind,syntax,options?.hasErrors||childErrors||type?.typeKind==='error');this.type=type??null;this.legacyType=options?.legacyType??null;this.constantValue=options?.constantValue??null;}
  get isExpression(){return true;}
  /** Options that carry this expression's non-structural state into a copy. */
  get options(){return {legacyType:this.legacyType,constantValue:this.constantValue,hasErrors:this.ownErrors};}
}
export class BoundStatement extends BoundNode {
  constructor(kind,syntax,options,childErrors){super(kind,syntax,options?.hasErrors||childErrors);}
  get isExpression(){return false;}
}
`;
for(const n of all){
  const names=n.fields.map(f=>f[0]),kids=children(n),childList=kids.map(([name,kind])=>kind==='nodes'?`...this.${name}`:`this.${name}`).join(','),errs=kids.length?`anyErrors([${kids.map(([name])=>name).join(',')}])`:'false';
  const assign=n.fields.map(([name,kind])=>kind==='nodes'?`this.${name}=Object.freeze([...${name}]);`:kind==='node?'||kind==='value'?`this.${name}=${name}??null;`:`this.${name}=${name};`).join('');
  const destructure=names.length?`{${names.join(',')}}`:'_fields';
  const same=n.fields.map(([name,kind])=>kind==='nodes'?`sameList(${name},this.${name})`:`${name}===this.${name}`);
  nodes+=`/** ${n.doc} */
export class Bound${n.name} extends ${n.expression?'BoundExpression':'BoundStatement'} {
  constructor(syntax,${destructure}${names.length?'':'={}'}${n.expression?',type=null':''},options=null){super('${n.name}',syntax,${n.expression?'type,':''}options,${errs});this.ownErrors=!!options?.hasErrors;${assign}Object.freeze(this);}
  get children(){return [${childList}]${kids.some(([,k])=>k==='node?')?'.filter(Boolean)':''};}
  update(${names.length?`{${names.map(x=>`${x}=this.${x}`).join(',')}}={}`:'_fields'}${n.expression?',type=this.type':''}){return ${[...same,...(n.expression?['type===this.type']:[])].join('&&')||'true'}?this:new Bound${n.name}(this.syntax,{${names.join(',')}}${n.expression?',type,this.options':',{hasErrors:this.ownErrors}'});}
  accept(visitor,argument){return visitor.visit${n.name}(this,argument);}
}
`;
}
nodes+=`function sameList(a,b){if(a===b)return true;if(!a||!b||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
export {boundNodeFields} from './fields.js';
`;
const fields=banner+`/** Field kinds per node kind, shared by the tree dumper and generic tooling. */
export const boundNodeFields=Object.freeze({
${all.map(n=>`  ${n.name}:Object.freeze([\n${n.fields.map(([name,kind])=>`    ['${name}','${kind}']`).join(',\n')}\n  ])`).join(',\n')}
});
`;
const visitor=banner+`/**
 * Visitors over the bound tree. \`BoundTreeVisitor\` dispatches on node kind with every \`visitX\` falling back to
 * \`visitDefault\`; \`BoundTreeWalker\` visits every child in evaluation order.
 */
export class BoundTreeVisitor {
  visit(node,argument){return node?node.accept(this,argument):undefined;}
  visitDefault(node,argument){return undefined;}
${all.map(n=>`  visit${n.name}(node,argument){return this.visitDefault(node,argument);}`).join('\n')}
}
export class BoundTreeWalker extends BoundTreeVisitor {
  visitList(nodes,argument){for(const node of nodes)this.visit(node,argument);}
  visitDefault(node,argument){this.visitList(node.children,argument);return undefined;}
}
`;
const rewriter=banner+`import {BoundTreeVisitor} from './visitor.js';
/**
 * Rewrites a bound tree bottom-up. Each \`visitX\` rewrites the children and calls \`node.update\`, so a rewriter that
 * changes nothing returns the identical tree. Lowering passes override the \`visitX\` methods they care about.
 */
export class BoundTreeRewriter extends BoundTreeVisitor {
  visitList(nodes){let result=null;for(let i=0;i<nodes.length;i++){const before=nodes[i],after=this.visit(before);if(after!==before&&!result)result=nodes.slice(0,i);if(result&&after!==null&&after!==undefined)result.push(after);}return result??nodes;}
  visitDefault(node){return node;}
${all.map(n=>{const kids=children(n);return `  visit${n.name}(node){${kids.length?`return node.update({${kids.map(([name,kind])=>kind==='nodes'?`${name}:this.visitList(node.${name})`:kind==='node?'?`${name}:node.${name}?this.visit(node.${name}):null`:`${name}:this.visit(node.${name})`).join(',')}});`:'return node;'}}`;}).join('\n')}
}
`;
let stale=false;
const outputs=[['nodes.js',nodes],['fields.js',fields],['visitor.js',visitor],['rewriter.js',rewriter]];
for(const [file,text] of outputs){const path=join(dir,file);if(process.argv.includes('--check')){if(!existsSync(path)||readFileSync(path,'utf8')!==text){console.error(file+' is stale; run packages/compiler/scripts/generate-bound-nodes.js');stale=true;}}else writeFileSync(path,text);}
if(stale)process.exit(1);if(!process.argv.includes('--check'))console.log(`Generated ${all.length} bound node classes.`);
