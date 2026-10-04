import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceText} from '@sharpforge/text';
import {parse} from '@sharpforge/syntax';
import {Compilation} from '@sharpforge/compiler';
import {lowerMethodBody,defaultPasses,LoweringPass,IdentityRewriter,localRewritingPass,closureConversionPass,iteratorRewritingPass,asyncRewritingPass,spillingPass} from '../packages/compiler/src/lowering/pipeline.js';
import {LocalRewriter} from '../packages/compiler/src/lowering/local-rewriter.js';
import * as names from '../packages/compiler/src/lowering/generated-names.js';
import {BoundTreeRewriter} from '../packages/compiler/src/bound/rewriter.js';
import {dumpBoundTree} from '../packages/compiler/src/bound/dump.js';
import {WellKnownMembers} from '../packages/compiler/src/symbols/well-known-members.js';
import {TypeProvider} from '../packages/compiler/src/symbols/special-types.js';
import {NamespaceSymbol} from '../packages/compiler/src/symbols/namespaces.js';
import {boundFixtures,bindFixture} from '../packages/compiler/test/bound/fixtures.js';
const bind=(source,options={})=>{const compilation=new Compilation([parse(new SourceText(source,'Program.cs'))],{...options,pipeline:'bound'}),result=compilation.build();return {compilation,result,pipeline:compilation.boundPipeline,unit:name=>compilation.boundPipeline.units.find(u=>u.method.name===name)};};
const each=(node,visit)=>{visit(node);for(const child of node.children)each(child,visit);};
const kinds=node=>{const set=new Set();each(node,n=>set.add(n.kind));return set;};
test('A02-T31 the pipeline runs local rewriting, closure conversion, iterator, async and spilling passes in order',()=>{
  assert.deepEqual(defaultPasses.map(p=>p.name),['local-rewriter','closure-conversion','iterator-rewriter','async-rewriter','spilling']);
  assert.deepEqual(defaultPasses,[localRewritingPass,closureConversionPass,iteratorRewritingPass,asyncRewritingPass,spillingPass]);assert(Object.isFrozen(defaultPasses));
  const {pipeline,unit}=bind('int a=1;Console.WriteLine($"{a}");'),trace=[];lowerMethodBody(unit('<Main>').body,{...pipeline.context,trace:(name,before,after)=>trace.push([name,before!==after])});
  assert.deepEqual(trace,[['local-rewriter',true],['closure-conversion',false],['iterator-rewriter',false],['async-rewriter',false],['spilling',false]]);assert.equal(lowerMethodBody(null,pipeline.context),null);
});
test('A02-T31 a pipeline of no-op passes preserves bound trees',()=>{
  const noop=[closureConversionPass,iteratorRewritingPass,asyncRewritingPass,spillingPass,new LoweringPass('custom',context=>new IdentityRewriter(context)),new LoweringPass('plain',()=>new BoundTreeRewriter())];let bodies=0;
  for(const [,source,options] of boundFixtures){const f=bindFixture(source,options);for(const unit of f.compilation.boundPipeline.units){if(!unit.body)continue;bodies++;assert.equal(lowerMethodBody(unit.body,f.compilation.boundPipeline.context,noop),unit.body,unit.method.qualifiedName);}}
  assert(bodies>40);
});
test('A02-T31 synthesized names follow the Roslyn patterns',()=>{
  assert.equal(names.stateMachineTypeName('M',0),'<M>d__0');assert.equal(names.stateMachineTypeName('MoveNextAsync',12),'<MoveNextAsync>d__12');assert.equal(names.displayClassName(0,0),'<>c__DisplayClass0_0');assert.equal(names.displayClassName(3,1),'<>c__DisplayClass3_1');
  assert.equal(names.staticLambdaDisplayClassName(),'<>c');assert.equal(names.lambdaMethodName('Main',0,0),'<Main>b__0_0');assert.equal(names.lambdaMethodName('Run',2,1),'<Run>b__2_1');assert.equal(names.localFunctionName('Main','Add',0,0),'<Main>g__Add|0_0');
  assert.equal(names.lambdaCacheFieldName(0,1),'<>9__0_1');assert.equal(names.staticLambdaDisplayClassInstanceFieldName(),'<>9');assert.equal(names.displayClassLocalName(0),'CS$<>8__locals0');
  assert.equal(names.hoistedLocalFieldName('count',1),'<count>5__1');assert.equal(names.hoistedSynthesizedLocalFieldName(2),'<>s__2');assert.equal(names.hoistedWrapFieldName(1),'<>7__wrap1');
  assert.equal(names.stateMachineStateFieldName(),'<>1__state');assert.equal(names.iteratorCurrentFieldName(),'<>2__current');assert.equal(names.iteratorThreadIdFieldName(),'<>l__initialThreadId');assert.equal(names.asyncBuilderFieldName(),'<>t__builder');assert.equal(names.awaiterFieldName(1),'<>u__1');
  assert.equal(names.thisProxyFieldName(),'<>4__this');assert.equal(names.stateMachineParameterProxyFieldName('value'),'<>3__value');assert.equal(names.backingFieldName('Name'),'<Name>k__BackingField');assert.equal(names.primaryConstructorParameterFieldName('x'),'<x>P');
  assert.equal(names.anonymousTypeName(0),'<>f__AnonymousType0');assert.equal(names.anonymousTypeFieldName('Id'),'<Id>i__Field');assert.equal(names.transparentIdentifierName(0),'<>h__TransparentIdentifier0');assert.equal(names.topLevelMainMethodName(),'<Main>$');assert.equal(names.recordCloneMethodName(),'<Clone>$');
  assert.equal(names.stateMachineTypeName('M',0,2),'<M>d__0#2','edit-and-continue generations are suffixed');assert.equal(names.displayClassName(1,2,3),'<>c__DisplayClass1_2#3');
  assert.deepEqual(names.parseGeneratedName('<M>d__0'),{prefix:'M',kind:'d',suffix:'0'});assert.deepEqual(names.parseGeneratedName('<Name>k__BackingField'),{prefix:'Name',kind:'k',suffix:'BackingField'});assert.deepEqual(names.parseGeneratedName('CS$<>8__locals0'),{prefix:'',kind:'8',suffix:'locals0'});assert.equal(names.parseGeneratedName('Main'),null);
  assert.equal(names.parseGeneratedName('<M>d__0').kind,names.GeneratedNameKind.StateMachineType);assert.equal(names.isGeneratedName('<>c'),true);assert.equal(names.isGeneratedName('Program'),false);
  // The compiler's own auto-property backing fields already use the Roslyn name.
  const {compilation}=bind('Console.WriteLine(new C().Value); class C{public int Value{get;set;}}');assert.equal(compilation.types[0].fields[0].name,names.backingFieldName('Value'));
});
test('A02-T31 using statements lower to try/finally with a null-guarded Dispose',()=>{
  const {unit,result}=bind('using(R a=new R(),b=new R()){Console.WriteLine(1);} class R:IDisposable{public void Dispose(){}}');assert.equal(result.success,true);
  const body=unit('<Main>').body,lowered=unit('<Main>').lowered;assert(kinds(body).has('UsingStatement'));assert(!kinds(lowered).has('UsingStatement')&&!kinds(lowered).has('UsingResource'));
  assert.equal(dumpBoundTree(lowered.statements[0]),[
    'Block locals=[a:R]','  MultipleLocalDeclarations','    LocalDeclaration local=a:R','      ObjectCreationExpression : R','  TryStatement',
    '    Block locals=[b:R]','      MultipleLocalDeclarations','        LocalDeclaration local=b:R','          ObjectCreationExpression : R','      TryStatement',
    '        Block','          ExpressionStatement','            Call method=System.Console.WriteLine(object) intrinsic=Console.WriteLine : void','              Literal value=1 : int = 1',
    '        Block','          IfStatement','            BinaryOperator operator="!=" isChecked=false negate=false : bool','              Local local=b:R : R','              Literal : <null> = null','            ExpressionStatement','              Call method=R.Dispose() : void','                Local local=b:R : R',
    '    Block','      IfStatement','        BinaryOperator operator="!=" isChecked=false negate=false : bool','          Local local=a:R : R','          Literal : <null> = null','        ExpressionStatement','          Call method=R.Dispose() : void','            Local local=a:R : R'].join('\n'));
  assert.equal(lowered.statements[0].statements[1].finallyBlock.statements[0].syntax.debugHidden,true,'the synthesized guard has no sequence point');
});
test('A02-T31 pattern-based foreach lowers to GetEnumerator/MoveNext/Current/Dispose',()=>{
  const {unit,result}=bind('using System.Collections.Generic;var list=new List<int>{1,2};foreach(var v in list){Console.WriteLine(v);}');assert.equal(result.success,true);
  const lowered=unit('<Main>').lowered.statements[1],dump=dumpBoundTree(lowered);assert(!kinds(lowered).has('ForEachStatement'));
  assert.deepEqual(dump.split('\n').filter(l=>/^\s*(Block|TryStatement|WhileStatement|MultipleLocalDeclarations)/.test(l)).map(l=>l.trim().split(' ')[0]),['Block','MultipleLocalDeclarations','TryStatement','WhileStatement','Block','MultipleLocalDeclarations','Block','Block']);
  assert.match(dump,/WhileStatement\n\s+Call method=SharpForge\.Runtime\.Enumerator<int>\.MoveNext\(\) : bool/);assert.match(dump,/LocalDeclaration local=v:int\n\s+PropertyAccess property=SharpForge\.Runtime\.Enumerator<int>\.Current : int/);assert.match(dump,/Call method=SharpForge\.Runtime\.Enumerator<int>\.Dispose\(\) : void/);
  // Array iteration is expanded by code generation and stays a foreach.
  const array=bind('foreach(int v in new int[]{1}){Console.WriteLine(v);}');assert(kinds(array.unit('<Main>').lowered).has('ForEachStatement'));
});
test('A02-T31 interpolation, boxing and await lower to runtime helpers from the well-known member table',()=>{
  const {unit,result,pipeline}=bind('using System.Collections.Generic;using System.Threading.Tasks;class P{static async Task Main(){int a=4;Console.WriteLine($"a={a,3:D2}!");var objects=new List<object>();objects.Add(a);await Task.Delay(1);}}');assert.equal(result.success,true,JSON.stringify(result.diagnostics));
  const body=result.image.methods.find(m=>m.asyncRole==='body'),bound=pipeline.units.find(u=>u.method===pipeline.c.methods[body.id]),before=kinds(bound.body),after=kinds(bound.lowered);
  for(const kind of ['InterpolatedString','StringInsert','AwaitExpression'])assert(before.has(kind)&&!after.has(kind),kind);assert(before.has('Conversion')&&!after.has('Conversion'),'boxing conversion');
  const dump=dumpBoundTree(bound.lowered);
  assert.match(dump,/Call method=SharpForge\.Runtime\.Formatting\.FormatValue\(object, string, int, string\) : string\n\s+Local local=a:int : int\n\s+Literal value="D2" : string\n\s+Literal value=3 : int\n\s+Literal value="int" : string/);
  assert.match(dump,/Call method=SharpForge\.Runtime\.Formatting\.BoxValue\(object, string\) : object\n\s+Local local=a:int : int\n\s+Literal value="int" : string/);assert.match(dump,/Call method=SharpForge\.Runtime\.Async\.Await\(System\.Threading\.Tasks\.Task\) : void/);
  assert.equal(pipeline.wellKnown.get('SharpForge_Runtime_Formatting__FormatValue').contract.name,'FormatValue');
});
test('A02-T31 a missing compiler-required member is reported as CS0656 by the lowering pass',()=>{
  const {unit,compilation}=bind('int a=1;string s=$"{a}";Console.WriteLine(s);'),reports=[],empty=new WellKnownMembers(new TypeProvider(new NamespaceSymbol()),(node,code,args)=>reports.push([code,...args]));
  const context={types:name=>compilation.semantic.typeOf(name),wellKnown:empty,report:()=>{}},lowered=new LocalRewriter(context).visit(unit('<Main>').body);
  assert.deepEqual(reports,[['CS0656','SharpForge.Runtime.Formatting','FormatValue']]);assert(kinds(lowered).has('InterpolatedString'),'the node is left in place when its helper is missing');
});
