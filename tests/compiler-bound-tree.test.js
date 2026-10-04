import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {BoundKind,BoundNode,BoundExpression,BoundStatement,BoundLiteral,BoundBinaryOperator,BoundBlock,BoundExpressionStatement,boundNodeFields} from '../packages/compiler/src/bound/nodes.js';
import {BoundTreeVisitor,BoundTreeWalker} from '../packages/compiler/src/bound/visitor.js';
import {BoundTreeRewriter} from '../packages/compiler/src/bound/rewriter.js';
import {dumpBoundTree,dumpBoundTreeLines} from '../packages/compiler/src/bound/dump.js';
import {TypeSymbol} from '../packages/compiler/src/symbols/types.js';
import {boundFixtures,bindFixture} from '../packages/compiler/test/bound/fixtures.js';
const pkg=fileURLToPath(new URL('../packages/compiler/',import.meta.url)),spec=JSON.parse(readFileSync(join(pkg,'src/bound/nodes.json'),'utf8')),snapshots=JSON.parse(readFileSync(join(pkg,'test/bound/snapshots.json'),'utf8'));
const bound=boundFixtures.map(([id,source,options])=>({id,...bindFixture(source,options)})),bodies=bound.flatMap(f=>f.compilation.boundPipeline.units.filter(u=>u.kind==='body'&&u.body).map(u=>u.body));
const each=(node,visit)=>{visit(node);for(const child of node.children)each(child,visit);};
test('A02-T26 generated bound node files are up to date with nodes.json',()=>{
  const r=spawnSync(process.execPath,[join(pkg,'scripts/generate-bound-nodes.js'),'--check'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const names=[...spec.expressions,...spec.statements].map(n=>n.name);assert.deepEqual(Object.keys(BoundKind),names);assert.deepEqual(Object.keys(boundNodeFields),names);assert(names.length>=60);
});
test('A02-T26 bound nodes carry type, constant value, syntax link and hasErrors',()=>{
  const syntax={kind:'Literal',start:0,end:1,uri:'a.cs'},int={typeKind:'struct',toDisplayString:()=>'int'},one=new BoundLiteral(syntax,{value:1},int,{legacyType:'int',constantValue:{value:1}}),two=new BoundLiteral(null,{value:2},int,{legacyType:'int'});
  assert(one instanceof BoundExpression&&one instanceof BoundNode);assert.equal(one.kind,BoundKind.Literal);assert.equal(one.syntax,syntax);assert.equal(one.type,int);assert.deepEqual(one.constantValue,{value:1});assert.equal(one.hasErrors,false);assert.equal(one.isExpression,true);assert.equal(two.syntax,null);
  const sum=new BoundBinaryOperator(null,{operator:'+',left:one,right:two,isChecked:false,method:null,negate:false},int,{legacyType:'int'});assert.deepEqual(sum.children,[one,two]);
  assert(Object.isFrozen(sum),'nodes are immutable');assert.throws(()=>{'use strict';sum.operator='-';},TypeError);
  assert.equal(sum.update({left:one,right:two}),sum,'update with the same parts returns the same node');const swapped=sum.update({left:two});assert.notEqual(swapped,sum);assert.equal(swapped.left,two);assert.equal(swapped.operator,'+');assert.equal(swapped.legacyType,'int');
  const bad=new BoundLiteral(null,{value:0},{typeKind:'error',toDisplayString:()=>'?'}),withBad=sum.update({right:bad});assert.equal(bad.hasErrors,true,'an error type marks the node');assert.equal(withBad.hasErrors,true,'errors propagate to parents');
  const statement=new BoundExpressionStatement(null,{expression:withBad}),block=new BoundBlock(null,{locals:[],statements:[statement]});assert(statement instanceof BoundStatement);assert.equal(statement.isExpression,false);assert.equal(block.hasErrors,true);assert.equal(new BoundBlock(null,{locals:[],statements:[]},{hasErrors:true}).hasErrors,true);
});
test('A02-T26 nodes cover every expression and statement kind of the legacy emitter switch',()=>{
  // Each syntax kind the fused MethodCompiler handled maps to the bound kind(s) the binder now produces for it.
  const coverage={InterpolatedString:['InterpolatedString','StringInsert'],Await:['AwaitExpression'],Default:['DefaultExpression'],Checked:['BinaryOperator'],Unchecked:['BinaryOperator'],Cast:['Conversion'],SwitchExpression:['SwitchExpression','SwitchExpressionArm','ConstantPattern'],Error:['BadExpression'],Literal:['Literal'],Name:['Local','Parameter','ThisReference','FieldAccess','PropertyAccess'],Member:['FieldAccess','PropertyAccess','ArrayLength'],Index:['ArrayAccess','IndexerAccess'],Binary:['BinaryOperator','NullCoalescingOperator'],Unary:['UnaryOperator','IncrementOperator'],Assignment:['AssignmentOperator','CompoundAssignmentOperator','NullCoalescingAssignmentOperator'],Conditional:['ConditionalOperator'],Call:['Call'],NewArray:['ArrayCreation'],New:['ObjectCreationExpression','ObjectInitializerMember','CollectionElementInitializer','DelegateCreationExpression'],CollectionExpression:['CollectionExpression','CollectionElement','CollectionSpread'],
    Block:['Block'],Empty:['NoOpStatement'],Using:['UsingStatement','UsingResource'],UsingDeclaration:['UsingStatement'],Local:['MultipleLocalDeclarations','LocalDeclaration'],ExpressionStatement:['ExpressionStatement'],If:['IfStatement'],While:['WhileStatement'],Do:['DoStatement'],For:['ForStatement'],OverflowContext:['CheckedStatement'],Foreach:['ForEachStatement','ForEachEnumerator'],Break:['BreakStatement'],Continue:['ContinueStatement'],Switch:['SwitchStatement','SwitchSection','SwitchLabel'],Return:['ReturnStatement'],Throw:['ThrowStatement'],Try:['TryStatement','CatchBlock'],Labeled:['ForStatement'],ConditionalMember:['ConditionalAccessAssignment'],ConditionalIndex:['ConditionalAccessAssignment']};
  const legacy=['method-compiler.js','modern.js'].map(f=>readFileSync(join(pkg,'src',f),'utf8')).join('\n'),kinds=new Set([...legacy.matchAll(/case '([A-Z][A-Za-z]+)'/g)].map(m=>m[1]));
  for(const kind of ['CollectionExpression','Labeled','ConditionalMember','ConditionalIndex'])kinds.add(kind);
  for(const kind of kinds)assert(coverage[kind],`legacy syntax kind '${kind}' has no bound node`);
  const produced=new Set();for(const body of bodies)each(body,n=>produced.add(n.kind));
  for(const [kind,nodes] of Object.entries(coverage))for(const name of nodes){assert(BoundKind[name],`${kind} -> ${name} is not a bound kind`);assert(produced.has(name),`no fixture produces Bound${name} (for ${kind})`);}
  const unused=Object.keys(BoundKind).filter(k=>!produced.has(k));assert.deepEqual(unused.sort(),['BadStatement','EventAssignmentOperator','Sequence','TypeExpression'].sort(),'every other bound kind is produced by the binder fixtures');
});
test('A02-T26 the identity rewriter returns the same tree and the walker visits every node',()=>{
  assert(bodies.length>40);const identity=new BoundTreeRewriter();
  for(const body of bodies){
    assert.equal(identity.visit(body),body,'identity rewrite');let walked=0;const walker=new (class extends BoundTreeWalker{visitDefault(node,arg){walked++;return super.visitDefault(node,arg);}})();walker.visit(body);
    let counted=0;each(body,()=>counted++);assert.equal(walked,counted);assert.equal(dumpBoundTreeLines(body).length,counted);
  }
  assert.equal(identity.visit(null),undefined);
  // A visitor dispatches on kind; a rewriter that changes one leaf rebuilds only the spine above it.
  const kinds=[];new (class extends BoundTreeVisitor{visitLiteral(n){kinds.push('literal:'+n.value);}visitDefault(n){kinds.push(n.kind);}})().visit(new BoundLiteral(null,{value:7}));assert.deepEqual(kinds,['literal:7']);
  const body=bound.find(f=>f.id==='expr-unary-binary').compilation.boundPipeline.units.find(u=>u.method.name==='<Main>').body;
  const rewritten=new (class extends BoundTreeRewriter{visitLiteral(n){return n.value===5?n.update({value:50}):n;}})().visit(body);
  assert.notEqual(rewritten,body);assert.equal(rewritten.statements[0].declarations[0].initializer.value,50);assert.equal(rewritten.statements[1],body.statements[1],'untouched statements are shared');assert.equal(rewritten.statements.length,body.statements.length);
});
test('A02-T27/T28 bound tree dumps of the binder fixtures match their snapshots',()=>{
  assert.deepEqual(bound.map(f=>f.id),Object.keys(snapshots),'run packages/compiler/test/bound/update-snapshots.js');
  for(const f of bound){const pinned=snapshots[f.id];assert.deepEqual(f.diagnostics,pinned.diagnostics,f.id);assert.deepEqual(Object.keys(f.methods),Object.keys(pinned.methods),f.id);for(const [name,dump] of Object.entries(f.methods))assert.equal(dump,pinned.methods[name].join('\n'),`${f.id}: ${name}`);}
});
test('A02-T27 bound expressions are typed with TypeSymbols',()=>{
  let expressions=0;
  for(const body of bodies)each(body,n=>{if(!n.isExpression)return;expressions++;assert(n.type===null||n.type instanceof TypeSymbol,n.kind+' has a TypeSymbol type');if(n.type===null)assert(n.legacyType==='null','only the null literal is typeless, got '+n.kind+' '+n.legacyType);});
  assert(expressions>400);
  const main=bound.find(f=>f.id==='expr-conditional-cast-default').compilation.boundPipeline.units.find(u=>u.method.name==='<Main>').body,cast=main.statements[2].declarations[0].initializer;
  assert.equal(cast.kind,'Conversion');assert.equal(cast.type.specialType,'System_Int32');assert.equal(cast.operand.type.specialType,'System_Double');assert.deepEqual(cast.conversion,{kind:'ExplicitNumeric',from:'double',to:'int'});assert.equal(cast.isExplicit,true);
  const list=bound.find(f=>f.id==='expr-collection-target-typed').methods['<Main>'];assert.match(list,/CollectionExpression collection=\$temp\d+:System\.Collections\.Generic\.List<int> : System\.Collections\.Generic\.List<int>/);
  assert.match(bound.find(f=>f.id==='expr-literal-name').methods['<Main>'],/Literal : <null> = null/);
  assert.equal(dumpBoundTree(new BoundLiteral(null,{value:'a'},null,{legacyType:'string'})),'Literal value="a" : ?');
});
test('A02-T27/T28 the binder emits no IR',()=>{
  const dir=join(pkg,'src/binder');for(const file of readdirSync(dir,{recursive:true})){if(!file.endsWith('.js'))continue;const text=readFileSync(join(dir,file),'utf8');
    assert(!/\bOp\./.test(text)&&!/\{[^}]*\bOp\b[^}]*\} from '@sharpforge\/bytecode'/.test(text),file+' references IR opcodes');assert(!/\.emit\(|emitConstant\(|emitContract\(/.test(text),file+' emits IR');assert(!/ir-emitter|method-compiler/.test(text),file+' depends on code generation');}
  // Binding a method leaves its record without code: emission is a separate, later stage.
  const f=bindFixture('int x="text";Console.WriteLine(x);');assert.equal(f.compilation.methods.every(m=>m.code===undefined),true);assert.deepEqual(f.diagnostics,['CS0029@6+6'],'on the initializer expression, where Roslyn reports it');assert(f.methods['<Main>'].includes('LocalDeclaration local=x:int !'));
});
test('A02-T27/T28 the binder records which syntax produced each bound node and each scope',()=>{
  const f=bindFixture('int a=1;{int b=a+2;Console.WriteLine(b);}'),unit=f.compilation.boundPipeline.units.find(u=>u.method.name==='<Main>'),binder=unit.binder;let plus=null;
  for(const [syntax,node] of binder.boundMap)if(syntax.kind==='Binary')plus=node;
  assert.equal(plus.kind,'BinaryOperator');assert.equal(plus.syntax.operator,'+');assert.equal(plus.left.local.name,'a');assert(binder.scopeSpans.length>=3);assert.equal(binder.scopeSpans.at(-1).binder.locals.has('b'),true);
});
