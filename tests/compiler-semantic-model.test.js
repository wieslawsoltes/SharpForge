import test from 'node:test';
import assert from 'node:assert/strict';
import {walk} from '@sharpforge/syntax';
import {SemanticModel,compile,Compilation} from '@sharpforge/compiler';
import {SourceText} from '@sharpforge/text';
import {parse} from '@sharpforge/syntax';
import {SymbolKind,SymbolDisplayFormat as F} from '../packages/compiler/src/symbols/types.js';
import {MethodKind} from '../packages/compiler/src/symbols/members.js';
import {analyzeRegion,regionStatements} from '../packages/compiler/src/flow/region-analysis.js';
const source=`using System.Collections.Generic;
var cart = new Shop.Cart("ann");
var items = new List<int> { 1, 2 };
int total = cart.Add(3) + items.Count;
foreach (var item in items) { total += item; }
Console.WriteLine($"{cart.Owner}: {total}");
namespace Shop
{
    class Cart
    {
        public int Count;
        public string Owner { get; set; }
        public Cart(string owner) { Owner = owner; }
        public int Add(int amount)
        {
            const int Limit = 10;
            int next = Count + amount;
            if (next > Limit) { string note = "full"; Console.WriteLine(note); return Count; }
            Count = next;
            return Count;
        }
        public static double Half(double value) { return value / 2; }
    }
}
`;
const {model,result,compilation}=SemanticModel.create([{uri:'Shop.cs',text:source}]),root=compilation.inputFiles[0].root,nodes=[];walk(root,n=>nodes.push(n));
const text=n=>source.slice(n.start,n.end),find=(kind,snippet,index=0)=>{const hits=nodes.filter(n=>n.kind===kind&&text(n)===snippet);assert(hits.length>index,`no ${kind} node '${snippet}'`);return hits[index];},at=(snippet,occurrence=0)=>{let i=-1;for(let k=0;k<=occurrence;k++)i=source.indexOf(snippet,i+1);assert(i>=0,snippet);return i;};
// Symbols are large cyclic graphs: compare them by identity and never ask assert to render or deep-compare them.
const same=(a,b,message)=>assert(a===b,message??'expected the same symbol');
const show=s=>s?(s.kind===SymbolKind.Local?'local '+s.toDisplayString(F.Test):s.kind===SymbolKind.Parameter?'parameter '+s.toDisplayString():s.toDisplayString()):null;
test('A02-T39 the model is built over a successful bound compilation',()=>{
  assert.equal(result.success,true,JSON.stringify(result.diagnostics));assert(model instanceof SemanticModel);same(model.compilation,compilation);
  assert.throws(()=>new SemanticModel(new Compilation([parse(new SourceText('Console.WriteLine(1);'))],{pipeline:'legacy'})),TypeError);
  assert.doesNotThrow(()=>structuredClone(compile(source)),'compile results stay structured-cloneable: the model is not attached to them');
});
test('A02-T39 getSymbolInfo returns locals, parameters, fields, properties, methods and types',()=>{
  const symbol=(kind,snippet,index)=>show(model.getSymbolInfo(find(kind,snippet,index)).symbol);
  assert.equal(symbol('Name','amount'),'parameter int amount');assert.equal(symbol('Name','next'),'local System.Int32 next');assert.equal(symbol('Name','Count'),'Shop.Cart.Count');assert.equal(symbol('Name','Limit'),'local System.Int32 Limit');
  assert.equal(symbol('Member','cart.Owner'),'Shop.Cart.Owner');assert.equal(symbol('Member','items.Count'),'System.Collections.Generic.List<int>.Count');assert.equal(symbol('Call','cart.Add(3)'),'Shop.Cart.Add(int)');
  assert.equal(symbol('Member','cart.Add'),'Shop.Cart.Add(int)','the name part of a call means the method');assert.equal(symbol('Call','Console.WriteLine(note)'),'System.Console.WriteLine(object)');
  const created=model.getSymbolInfo(find('New','new Shop.Cart("ann")')).symbol;assert.equal(created.methodKind,MethodKind.Constructor);assert.equal(created.toDisplayString(),'Shop.Cart.Cart(string)');
  assert.equal(model.getSymbolInfo(find('New','new List<int> { 1, 2 }')).symbol.toDisplayString(),'System.Collections.Generic.List<int>.List()');
  const receiver=model.getSymbolInfo(find('Name','Console'));same(receiver.symbol,compilation.semantic.bridge.typeFromName('System.Console'),'a type used as a static receiver');assert.equal(receiver.candidateReason,'none');
  same(model.getSymbolInfo(find('Name','Owner')).symbol,model.getDeclaredSymbol(nodes.find(n=>n.kind==='Property')),'uses and declarations yield the same symbol');
  const missing=model.getSymbolInfo({kind:'Name',name:'nowhere',start:0,end:1,uri:'Shop.cs'});assert(missing.symbol===null);assert.equal(missing.candidateReason,'notFound');
});
test('A02-T39 getTypeInfo and getConstantValue describe expressions',()=>{
  const type=(kind,snippet,index)=>model.getTypeInfo(find(kind,snippet,index)).type?.toDisplayString()??null;
  assert.equal(type('Binary','Count + amount'),'int');assert.equal(type('Binary','next > Limit'),'bool');assert.equal(type('Binary','value / 2'),'double');assert.equal(type('Literal','"full"'),'string');assert.equal(type('New','new Shop.Cart("ann")'),'Shop.Cart');
  assert.equal(type('Name','items',1),'System.Collections.Generic.List<int>');assert.equal(type('Call','cart.Add(3)'),'int');assert.equal(type('InterpolatedString','$"{cart.Owner}: {total}"'),'string');assert.equal(type('Call','Console.WriteLine(note)'),'void');
  assert.equal(model.getTypeInfo(find('Variable','cart = new Shop.Cart("ann")')).type.toDisplayString(),'Shop.Cart','var is inferred');assert.equal(model.getTypeInfo(find('Name','Console')).type.toDisplayString(),'System.Console');
  const info=model.getTypeInfo(find('Binary','Count + amount'));same(info.convertedType,info.type);assert.equal(info.type.specialType,'System_Int32');assert(model.getTypeInfo({kind:'Name'}).type===null);
  assert.deepEqual(model.getConstantValue(find('Literal','10')),{hasValue:true,value:10});assert.deepEqual(model.getConstantValue(find('Name','Limit')),{hasValue:true,value:10},'a const local carries its value');assert.deepEqual(model.getConstantValue(find('Literal','"full"')),{hasValue:true,value:'full'});
  assert.deepEqual(model.getConstantValue(find('Binary','Count + amount')),{hasValue:false,value:undefined});
  const folded=SemanticModel.create('const int A=6;int b=A*7+nameof(b).Length;Console.WriteLine(b);'),folds=[];walk(folded.compilation.inputFiles[0].root,n=>{if(n.kind==='Binary')folds.push(folded.model.getConstantValue(n));});assert.deepEqual(folds[1],{hasValue:true,value:42});
});
test('A02-T39 getDeclaredSymbol maps declarations to symbols',()=>{
  const cls=model.getDeclaredSymbol(nodes.find(n=>n.kind==='Class'));assert.equal(cls.kind,SymbolKind.NamedType);assert.equal(cls.toDisplayString(),'Shop.Cart');assert.equal(cls.containingNamespace.qualifiedName,'Shop');
  const methods=nodes.filter(n=>n.kind==='Method').map(n=>model.getDeclaredSymbol(n));assert.deepEqual(methods.map(m=>m.toDisplayString(F.Test)),['Shop.Cart..ctor(System.String owner)','System.Int32 Shop.Cart.Add(System.Int32 amount)','System.Double Shop.Cart.Half(System.Double value)']);
  assert.equal(methods[0].methodKind,MethodKind.Constructor);assert.equal(methods[2].isStatic,true);same(methods[1].containingType,cls);
  assert.equal(model.getDeclaredSymbol(nodes.find(n=>n.kind==='Field')).toDisplayString(F.Test),'System.Int32 Shop.Cart.Count');assert.equal(model.getDeclaredSymbol(nodes.find(n=>n.kind==='Property')).toDisplayString(F.Test),'System.String Shop.Cart.Owner { get; set; }');
  const parameter=model.getDeclaredSymbol(nodes.find(n=>n.kind==='Parameter'&&n.name==='amount'));assert.equal(parameter.kind,SymbolKind.Parameter);same(parameter,methods[1].parameters[0]);
  const local=model.getDeclaredSymbol(find('Variable','next = Count + amount'));assert.equal(local.kind,SymbolKind.Local);assert.equal(local.type.specialType,'System_Int32');same(model.getSymbolInfo(find('Name','next',1)).symbol,local);
  assert.equal(model.getDeclaredSymbol(find('Variable','Limit = 10')).isConst,true);assert.equal(model.getDeclaredSymbol(nodes.find(n=>n.kind==='Foreach')).toDisplayString(F.Test),'System.Int32 item');assert(model.getDeclaredSymbol(find('Literal','10'))===null);assert(model.getDeclaredSymbol(null)===null);
});
test('A02-T39 lookupSymbols lists what is in scope at a position',()=>{
  const names=(position,options)=>model.lookupSymbols(position,{uri:'Shop.cs',...options}).map(s=>s.name);
  const inBlock=names(at('Console.WriteLine(note)'));for(const name of ['note','next','Limit','amount','Count','Owner','Add','Half','Cart','Shop','System'])assert(inBlock.includes(name),name+' is visible inside the if block');
  const afterBlock=names(at('Count = next'));assert(!afterBlock.includes('note'),'a local of an inner block is out of scope');assert(afterBlock.includes('next'));
  const early=names(at('const int Limit'));assert(!early.includes('next')&&!early.includes('Limit'),'locals are not visible before their declaration');assert(early.includes('amount'));
  const top=names(at('int total'));assert(top.includes('cart')&&top.includes('items')&&!top.includes('total')&&!top.includes('item')&&!top.includes('amount'));assert(top.includes('List'),'types from using directives are visible');
  assert.equal(show(model.lookupSymbols(at('Count = next'),{uri:'Shop.cs',name:'next'})[0]),'local System.Int32 next');assert.equal(show(model.lookupSymbols(at('Count = next'),{uri:'Shop.cs',name:'amount'})[0]),'parameter int amount');
  assert.deepEqual(model.lookupSymbols(at('Count = next'),{uri:'Shop.cs',name:'Add'}).map(s=>s.toDisplayString()),['Shop.Cart.Add(int)']);assert.equal(model.lookupSymbols(at('Count = next'),{uri:'Shop.cs',name:'note'}).length,0);
  assert.equal(model.lookupSymbols(at('Count = next'),{uri:'Shop.cs',name:'this'})[0].type.toDisplayString(),'Shop.Cart');assert.equal(model.lookupSymbols(at('value / 2'),{uri:'Shop.cs',name:'this'}).length,0,'no this in a static method');
  assert.deepEqual(model.lookupSymbols(at('int total'),{uri:'Shop.cs',name:'List',namespacesAndTypesOnly:true}).map(s=>s.toDisplayString()),['System.Collections.Generic.List<T>']);
  assert(model.lookupSymbols(at('Count = next'),{uri:'Shop.cs',namespacesAndTypesOnly:true}).every(s=>[SymbolKind.NamedType,SymbolKind.Namespace,SymbolKind.TypeParameter,SymbolKind.Alias].includes(s.kind)));
});
test('A02-T39 speculative binding evaluates an expression in the scope of a position without touching the compilation',()=>{
  const before=[compilation.diagnostics.length,compilation.symbols.length,compilation.references.length],where=at('Count = next');
  const sum=model.bindSpeculativeExpression(where,'next + amount * 2',{uri:'Shop.cs'});assert.equal(sum.type.toDisplayString(),'int');assert.deepEqual(sum.diagnostics,[]);assert.equal(sum.bound.kind,'BinaryOperator');same(sum.bound.left.local,model.getDeclaredSymbol(find('Variable','next = Count + amount')),'speculative code sees the real symbols');
  assert.equal(show(model.bindSpeculativeExpression(where,'Owner',{uri:'Shop.cs'}).symbol),'Shop.Cart.Owner');assert.equal(model.bindSpeculativeExpression(where,'Half(Count)',{uri:'Shop.cs'}).type.toDisplayString(),'double');
  assert.deepEqual(model.bindSpeculativeExpression(where,'Limit * 4',{uri:'Shop.cs'}).constantValue,{hasValue:true,value:40});assert.equal(model.getSpeculativeTypeInfo(where,'Owner + "!"',{uri:'Shop.cs'}).type.toDisplayString(),'string');
  const bad=model.bindSpeculativeExpression(where,'note.Length + missing',{uri:'Shop.cs'});assert.deepEqual(bad.diagnostics.map(d=>d.code).sort(),['CS0019','CS0103','CS1061'],'note is out of scope there and missing does not exist');assert.equal(bad.bound.hasErrors,true);
  assert.equal(model.bindSpeculativeExpression(at('Console.WriteLine(note)'),'note.Length',{uri:'Shop.cs'}).type.toDisplayString(),'int');
  assert.equal(model.bindSpeculativeExpression(at('int total'),'cart.Add(1) + items.Count',{uri:'Shop.cs'}).type.toDisplayString(),'int');assert.deepEqual(model.bindSpeculativeExpression(at('int total'),'total',{uri:'Shop.cs'}).diagnostics.map(d=>d.code),['CS0103'],'not declared yet at that position');
  assert.deepEqual([compilation.diagnostics.length,compilation.symbols.length,compilation.references.length],before,'the compilation is unchanged');
  assert(model.bindSpeculativeExpression(at('namespace Shop'),'1',{uri:'Shop.cs'}).bound===null,'no method body at that position');
});
test('A02-T39 flow results are available per method',()=>{
  const flow=model.getFlowAnalysis(at('Count = next'),'Shop.cs');assert(flow.graph.blocks.length>3);assert.equal(flow.reachability.endReachable,false);assert.equal(flow.assignment.diagnostics.length,0);assert(model.getFlowAnalysis(at('namespace Shop'),'Shop.cs')===null);
});
const regionSource=`class P
{
    static int Work(int seed, int limit)
    {
        int total = 0;
        int scale = seed * 2;
        int scratch;
        for (int i = 0; i < limit; i++)
        {
            scratch = i * scale;
            if (scratch > 100) break;
            total += scratch;
        }
        int unused = 5;
        Console.WriteLine(total);
        return total + scale;
    }
    static int Pick(int a)
    {
        if (a > 0) { int doubled = a * 2; return doubled; }
        while (true) { a++; if (a > 5) continue; }
    }
    static void Main() { Console.WriteLine(Work(1, 3)); }
}
`;
const region=SemanticModel.create([{uri:'R.cs',text:regionSource}]),span=(from,to)=>[regionSource.indexOf(from),regionSource.indexOf(to)+to.length],names=list=>list.map(v=>v.name);
test('A02-T35 data-flow analysis of a region reports reads, writes and what flows in and out',()=>{
  const [start,end]=span('for (int i','total += scratch;\n        }'),flow=region.model.analyzeDataFlow(start,end,{uri:'R.cs'});
  assert.deepEqual(names(flow.variablesDeclared),['i']);assert.deepEqual(names(flow.readInside),['limit','total','scale','scratch','i']);assert.deepEqual(names(flow.writtenInside),['total','scratch','i']);
  assert.deepEqual(names(flow.dataFlowsIn),['limit','total','scale'],'total is read by += before the region assigns it; scratch is assigned first');assert.deepEqual(names(flow.dataFlowsOut),['total'],'only total is read after the loop');
  assert.deepEqual(names(flow.alwaysAssigned),['i'],'the body may not run, the loop variable is always initialised');assert.deepEqual(names(flow.readOutside),['seed','total','scale']);assert.deepEqual(names(flow.writtenOutside),['seed','limit','total','scale','unused']);assert.equal(flow.captured.length,0);
  const [a,b]=span('int total = 0;','int scale = seed * 2;'),head=region.model.analyzeDataFlow(a,b,{uri:'R.cs'});assert.deepEqual(names(head.variablesDeclared),['total','scale']);assert.deepEqual(names(head.dataFlowsIn),['seed']);assert.deepEqual(names(head.dataFlowsOut),['total','scale']);assert.deepEqual(names(head.alwaysAssigned),['total','scale']);
  const [c,d]=span('int unused = 5;','int unused = 5;'),dead=region.model.analyzeDataFlow(c,d,{uri:'R.cs'});assert.deepEqual(names(dead.dataFlowsOut),[],'a value nobody reads does not flow out');assert.deepEqual(names(dead.dataFlowsIn),[]);
  const [e,f]=span('scratch = i * scale;','scratch = i * scale;'),inner=region.model.analyzeDataFlow(e,f,{uri:'R.cs'});assert.deepEqual(names(inner.dataFlowsIn),['scale','i']);assert.deepEqual(names(inner.dataFlowsOut),['scratch']);assert.deepEqual(names(inner.variablesDeclared),[]);
});
test('A02-T35 control-flow analysis of a region reports exits and end-point reachability',()=>{
  const [start,end]=span('for (int i','total += scratch;\n        }'),loop=region.model.analyzeControlFlow(start,end,{uri:'R.cs'});
  assert.deepEqual([loop.startPointIsReachable,loop.endPointIsReachable,loop.exitPoints.length,loop.returnStatements.length,loop.entryPoints.length],[true,true,0,0,0],'the break stays inside the selected loop');
  const [a,b]=span('scratch = i * scale;','total += scratch;'),body=region.model.analyzeControlFlow(a,b,{uri:'R.cs'});assert.deepEqual(body.exitPoints.map(n=>n.kind),['BreakStatement'],'selecting only the loop body makes the break an exit point');assert.equal(body.endPointIsReachable,true);
  const [c,d]=span('if (a > 0)','return doubled; }'),early=region.model.analyzeControlFlow(c,d,{uri:'R.cs'});assert.deepEqual(early.returnStatements.map(n=>n.kind),['ReturnStatement']);assert.equal(early.exitPoints.length,1);assert.equal(early.endPointIsReachable,true);
  const [e,f]=span('while (true)','continue; }'),forever=region.model.analyzeControlFlow(e,f,{uri:'R.cs'});assert.equal(forever.endPointIsReachable,false);assert.equal(forever.exitPoints.length,0);
  const [g,h]=span('return total + scale;','return total + scale;'),last=region.model.analyzeControlFlow(g,h,{uri:'R.cs'});assert.equal(last.endPointIsReachable,false);assert.equal(last.returnStatements.length,1);
});
test('A02-T35 region selection picks the statements of one list and fails cleanly otherwise',()=>{
  const body=region.compilation.boundPipeline.units.find(u=>u.method.name==='Work').body,[start,end]=span('int total = 0;','int scratch;');
  assert.deepEqual(regionStatements(body,start,end).map(s=>s.kind),['MultipleLocalDeclarations','MultipleLocalDeclarations','MultipleLocalDeclarations']);assert.deepEqual(regionStatements(body,0,3),[]);assert.deepEqual(regionStatements(null,0,10),[]);
  const none=analyzeRegion(body,{start:0,end:3});assert.equal(none.succeeded,false);assert.equal(none.dataFlow.dataFlowsIn.length,0);assert.equal(none.controlFlow.endPointIsReachable,false);assert(region.model.analyzeDataFlow(0,3,{uri:'R.cs'})===null,'no method at that position');
  assert.equal(analyzeRegion(body,{start,end}).succeeded,true);
});
