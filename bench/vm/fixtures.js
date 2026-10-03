const iterations = 20000;
const program = body => `using System; class P {static void Main(){${body}}}`;
export const microbenchmarks = Object.freeze([
  {id: 'arith', source: program(`int sum=0;for(int i=0;i<${iterations};i++){sum+=3;}Console.WriteLine(sum);`), expected: '60000\n'},
  {id: 'calls', source: `using System;class P {static int Add(int a){return a+3;}
    static void Main(){int sum=0;for(int i=0;i<${iterations};i++){sum=Add(sum);}Console.WriteLine(sum);}}`, expected: '60000\n'},
  {id: 'virtual', virtual: true, expectedReturn: iterations * 7, iterations,
    unsupported: {source: 'Source IR has no virtual call opcode; a plain call is not a substitute',
      reloaded: 'Canonical source IR cannot retain this polymorphic callvirt fixture'}},
  {id: 'fields', source: `using System;class Box {public int Value;}class P {static void Main(){Box b=new Box();
    for(int i=0;i<${iterations};i++){b.Value+=1;}Console.WriteLine(b.Value);}}`, expected: '20000\n'},
  {id: 'arrays', source: program(`int[] a=new int[256];for(int i=0;i<256;i++){a[i]=i;}
    int sum=0;for(int r=0;r<80;r++){for(int i=0;i<256;i++){sum+=a[i];}}Console.WriteLine(sum);`), expected: '2611200\n'},
  {id: 'strings', source: program('string text="";for(int i=0;i<2000;i++){text=("ab"+text).Substring(0,2);}Console.WriteLine(text);'),
    expected: 'ab\n'},
  {id: 'exceptions', source: program('int count=0;for(int i=0;i<500;i++){try{throw new Exception("test");}' +
    'catch(Exception error){count++;}}Console.WriteLine(count);'), expected: '500\n'},
  {id: 'allocation', source: `using System;class Box {public int Value;}class P {static void Main(){int sum=0;
    for(int i=0;i<${iterations};i++){Box b=new Box();b.Value=1;sum+=b.Value;}Console.WriteLine(sum);}}`, expected: '20000\n'},
]);

/** Complete small apps: collection processing, rectangular computation, and text production. */
export const startupApps = Object.freeze([
  {id: 'invoice', source: program('decimal[] prices=new decimal[]{1.25M,2.50M,3.75M};decimal total=0M;' +
    'for(int i=0;i<prices.Length;i++){total+=prices[i];}Console.WriteLine(total);'), expected: '7.50\n'},
  {id: 'grid', source: program('int[,] cells=new int[8,8];int total=0;' +
    'for(int r=0;r<8;r++){for(int c=0;c<8;c++){cells[r,c]=r*8+c;total+=cells[r,c];}}Console.WriteLine(total);'), expected: '2016\n'},
  {id: 'text-report', source: program('string result="";for(int i=0;i<100;i++){result+="row;";}' +
    'Console.WriteLine(result.Length);'), expected: '400\n'},
]);
export const snapshotCase = Object.freeze({id: 'snapshot-copy',
  source: program('int[] values=new int[4096];for(int i=0;i<values.Length;i++){values[i]=i;}' +
    'Console.WriteLine("snapshot");int sum=0;for(int i=0;i<values.Length;i++){sum+=values[i];}Console.WriteLine(sum);'),
  expected: 'snapshot\n8386560\n'});
export const engines = Object.freeze(['source', 'reloaded', 'cil']);
