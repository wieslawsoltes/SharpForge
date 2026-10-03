import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileToIL} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {loadAssembly,AssemblyInspector,formatILDocument,assembleILDocument} from '@sharpforge/cil';

const cases = [
 ['nested rethrow restores lexical exception','try{try{throw new Exception("outer");}catch(Exception e){try{throw new Exception("inner");}catch(Exception f){Console.WriteLine(f.Message);}throw;}}catch(Exception g){Console.WriteLine(g.Message);}','inner\nouter\n'],
 ['auto property', 'class C { public int X { get; set; } = 3; } var c = new C(); c.X += 4; Console.WriteLine(c.X);', '7\n'],
 ['expression getter', 'class C { public int X { get; set; } public int Double => X*2; } var c=new C(){X=7}; Console.WriteLine(c.Double);','14\n'],
 ['explicit accessors','class C { int x; public int X { get {return x;} set {x=value*2;} } } var c=new C();c.X=5;Console.WriteLine(c.X);','10\n'],
 ['expression accessors','class C { int x; public int X { get => x; set => x=value+1; } } var c=new C();c.X=5;Console.WriteLine(c.X);','6\n'],
 ['getter only constructor','class C { public int Id { get; } public C(int id) {this.Id=id;} } Console.WriteLine(new C(12).Id);','12\n'],
 ['static auto initialization','class C { public static int X {get;set;}=7; public static int Y => X+1; } Console.WriteLine(C.Y);C.X++;Console.WriteLine(C.Y);','8\n9\n'],
 ['assignment results','class C { public int X{get;set;} } var c=new C();Console.WriteLine(c.X=3);Console.WriteLine(c.X++);Console.WriteLine(++c.X);Console.WriteLine(c.X+=2);','3\n3\n5\n7\n'],
 ['property receiver evaluated once','class C { public int X {get;set;} } class P {static int calls;static C c=new C();static C Next(){calls++;return c;}static void Main(){Next().X+=4;Console.WriteLine(calls);Console.WriteLine(c.X);}}','1\n4\n'],
 ['coalescing property','class C {public string X{get;set;}} var c=new C();Console.WriteLine(c.X??="a");Console.WriteLine(c.X??="b");','a\na\n'],
 ['private setter inside owner','class C {public int X {get;private set;} public void Set(int x){X=x;}}var c=new C();c.Set(8);Console.WriteLine(c.X);','8\n'],
 ['nameof property','class C {public int X{get;set;}}Console.WriteLine(nameof(C.X));','X\n'],
 ['normal finally','try {Console.WriteLine(1);} finally {Console.WriteLine(2);}','1\n2\n'],
 ['return preserves value','int F(){int x=1;try{return x;}finally{x=2;Console.WriteLine(x);}}Console.WriteLine(F());','2\n1\n'],
 ['return reference remains rooted','class C{public int X=7;}C F(){try{return new C();}finally{GC.Collect();}}Console.WriteLine(F().X);','7\n'],
 ['exception finally then catch','try{try{throw new Exception("x");}finally{Console.WriteLine(1);}}catch(Exception e){Console.WriteLine(e.Message);}','1\nx\n'],
 ['try catch finally','try{throw new Exception("x");}catch(Exception e){Console.WriteLine(e.Message);}finally{Console.WriteLine(2);}','x\n2\n'],
 ['nested finally','int F(){try{return 3;}finally{try{Console.WriteLine(4);}finally{Console.WriteLine(5);}}}Console.WriteLine(F());','4\n5\n3\n'],
 ['catch inside finally preserves return','int F(){try{return 3;}finally{try{throw new Exception("inner");}catch(Exception e){Console.WriteLine(e.Message);}}}Console.WriteLine(F());','inner\n3\n'],
 ['throw from finally overrides return','int F(){try{return 3;}finally{throw new Exception("last");}}try{Console.WriteLine(F());}catch(Exception e){Console.WriteLine(e.Message);}','last\n'],
 ['throw from finally overrides exception','try{try{throw new Exception("first");}finally{throw new Exception("last");}}catch(Exception e){Console.WriteLine(e.Message);}','last\n'],
 ['break finally','while(true){try{break;}finally{Console.WriteLine(1);}}Console.WriteLine(2);','1\n2\n'],
 ['continue finally','for(int i=0;i<3;i++){try{continue;}finally{Console.WriteLine(i);}}','0\n1\n2\n'],
 ['loop internal finally','try{Console.WriteLine(0);}finally{for(int i=0;i<4;i++){if(i==1)continue;if(i==3)break;Console.WriteLine(i);}}','0\n0\n2\n'],
 ['empty protected clauses','try{}finally{}try{}catch(Exception e){}finally{}Console.WriteLine(1);','1\n'],
 ['catch return runs final','int F(){try{throw new Exception("x");}catch(Exception e){return 9;}finally{Console.WriteLine(1);}}Console.WriteLine(F());','1\n9\n'],
 ['property setter finally','class C {int x;public int X{get=>x;set{try{x=value;}finally{Console.WriteLine("set");}}}}var c=new C();c.X=7;Console.WriteLine(c.X);','set\n7\n'],
];
for (const [name,source,expected] of cases) for (const path of ['IR','canonical CIL','direct CIL','edited CIL']) test(`0.5 language: ${name} / ${path}`,()=>{
 const r=compileToIL(source);assert(r.success,JSON.stringify(r.diagnostics));
 const vm=path==='IR'?new VirtualMachine(r.image):path==='canonical CIL'?new VirtualMachine(loadAssembly(r.assembly)):new CilVirtualMachine(path==='edited CIL'?assembleILDocument(formatILDocument(r.assembly)).bytes:r.assembly);
 const result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,expected);
});
for(const [name,source,code] of [
 ['getter-only write','class C {public int X{get;}}var c=new C();c.X=1;','CS0200'],
 ['private setter','class C{public int X{get;private set;}}var c=new C();c.X=1;','CS0272'],
 ['write-only read','class C{public int X{set{}}}Console.WriteLine(new C().X);','CS0154'],
 ['duplicate getter','class C{public int X{get;get;}}Console.WriteLine(1);','CS1007'],
 ['auto write-only','class C{public int X{set;}}Console.WriteLine(1);','CS8051'],
 ['return exits finally','int F(){try{return 1;}finally{return 2;}}Console.WriteLine(F());','CS0157'],
 ['break exits finally','while(true){try{}finally{break;}}','CS0157'],
 ['continue exits finally','while(true){try{}finally{continue;}}','CS0157'],
 ['init remains explicit limitation','class C{public int X{get;init;}}Console.WriteLine(1);','CS1014'],
])test('0.5 diagnostic: '+name,()=>{const r=compile(source);assert.equal(r.success,false);assert(r.diagnostics.some(d=>d.code===code),JSON.stringify(r.diagnostics));});
test('0.5 metadata: property maps and method semantics survive canonical loading',()=>{
 const r=compileToIL('class C {public int X{get;private set;} public static int Count{get;set;}=3;} Console.WriteLine(C.Count);');assert(r.success);
 const i=new AssemblyInspector(r.assembly);assert.equal(i.metadata.rows[23].length,2);assert.equal(i.metadata.rows[24].length,4);
 const loaded=loadAssembly(r.assembly),c=loaded.types.find(t=>t.name==='C');assert.equal(c.properties.length,2);assert(c.fields.some(f=>f.backing));
});
