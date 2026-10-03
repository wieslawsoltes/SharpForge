/** Shared language cases: original regression suite and automatic engine parity discovery. */
export const cases=[
 ['field-backed mixed accessors and initialization','class P{int Value{get;set=>field=value*2;}=3;static void Main(){P p=new();Console.WriteLine(p.Value);p.Value=4;Console.WriteLine(p.Value);}}','3\n8\n'],
 ['field-backed explicit getter and setter','class P{int Value{get=>field+1;set{field=value;}}static void Main(){P p=new();p.Value=40;Console.WriteLine(p.Value);}}','41\n'],
 ['field escape resolves user field','class P{int @field=8;int Value{get=>field+@field;set=>field=value;}static void Main(){P p=new();p.Value=34;Console.WriteLine(p.Value);}}','42\n'],
 ['target typed parameters returns and field initializers','class P{public int N=42;static P Make(){return new();}static int Read(P p){return p.N;}static P item=new();static void Main(){Console.WriteLine(Read(new()));Console.WriteLine(Make().N);Console.WriteLine(item.N);}}','42\n42\n42\n'],
 ['null conditional property skips receiver RHS','class Box{public int N;}class P{static int calls;static Box Get(){calls++;return null;}static int Next(){calls+=10;return 42;}static void Main(){Get()?.N=Next();Console.WriteLine(calls);}}','1\n'],
 ['null conditional array skips index and RHS','class P{static int calls;static int Next(){calls++;return 0;}static void Main(){int[] a=null;a?[Next()]+=Next();Console.WriteLine(calls);a=[4];a?[Next()]+=2;Console.WriteLine(a[0]);Console.WriteLine(calls);}}','0\n6\n1\n'],
 ['null conditional compound accessor order','class Box{public int N{get;set;}=40;}class P{static Box b=new();static int calls;static Box Get(){calls++;return b;}static void Main(){Get()?.N+=2;Console.WriteLine(b.N);Console.WriteLine(calls);}}','42\n1\n'],
 ['collection expression empty array and list','int[] a=[];List<string> b=[];Console.WriteLine(a.Length);Console.WriteLine(b.Count);','0\n0\n'],
 ['collection expressions spread array and lists','int[] a=[1,2];List<int> b=[0,..a,3];int[] c=[..b,4];Console.WriteLine(string.Join(",",c));','0,1,2,3,4\n'],
 ['spread hash set preserves uniqueness','HashSet<int> a=[1,1,2];HashSet<int> b=[..a,2,3];Console.WriteLine(b.Count);','3\n'],
 ['collection returns and arguments','class P{static int[] Make(){return [1,2,3];}static int Sum(int[] a){return a[0]+a[1]+a[2];}static void Main(){Console.WriteLine(Sum([4,5,6]));Console.WriteLine(Sum(Make()));}}','15\n6\n'],
 ['collection expression evaluation order','class P{static int n;static int Next(){return ++n;}static int[] More(){return [Next(),Next()];}static void Main(){int[] a=[Next(),..More(),Next()];Console.WriteLine(string.Join(",",a));}}','1,2,3,4\n'],
 ['C#15 capacity arguments','List<int> a=[with(capacity:20),1,2,3];Console.WriteLine(a.Capacity);Console.WriteLine(a.Count);','20\n3\n','preview'],
 ['C#15 labeled continue and break','int total=0;outer:for(int i=0;i<4;i++){for(int j=0;j<4;j++){if(j==2)continue outer;total++;}}Console.WriteLine(total);outer2:while(true){for(int i=0;i<3;i++){break outer2;}}Console.WriteLine(42);','8\n42\n','preview'],
 ['C#15 labeled jumps execute finally','int n=0;outer:for(int i=0;i<3;i++){try{for(int j=0;j<4;j++){continue outer;}}finally{n++;}}Console.WriteLine(n);','3\n','preview'],
 ['escape E C#13','Console.WriteLine("\u001b"=="\\e");','True\n']
];
export const invalid=[
 ['field version','class P{int V{get=>field;}static void Main(){}}','13'],
 ['null conditional version','class P{public int N;static void Main(){P p=null;p?.N=1;}}','13'],
 ['collection version','int[] a=[1];','11'],
 ['target new version','class P{static void Main(){P p=new();}}','8'],
 ['capacity requires preview','List<int> a=[with(capacity:4),1];','14'],
 ['named jump requires preview','outer:for(int i=0;i<3;i++){continue outer;}','14'],
 ['collection requires target','var a=[1,2];','14'],
 ['new requires target','var p=new();','14'],
 ['spread requires enumerable','int[] a=[..42];','14'],
 ['unknown jump','for(int i=0;i<3;i++){break missing;}','preview'],
 ['continue switch disallowed','s:switch(1){case 1:continue s;}','preview'],
 ['array with capacity disallowed','int[] a=[with(capacity:4),1];','preview'],
 ['unknown capacity argument','List<int> a=[with(unknown:4),1];','preview'],
 ['null assignment increment disallowed','class P{public int N;static void Main(){P p=null;p?.N++;}}','14'],
 ['field local shadow rejected','class P{int V{get{int field=1;return field;}}static void Main(){}}','14']
];
export const languageFixtures=[
 ...cases.map(([name,source,output,langVersion='14'])=>({id:'language14/'+name,source:'using System;using System.Collections.Generic;'+source,compilationOptions:{langVersion},expected:{output}})),
 ...invalid.map(([name,source,langVersion])=>({id:'language14/diagnostic/'+name,source:'using System.Collections.Generic;'+source,compilationOptions:{langVersion},compileFailure:true}))
];
