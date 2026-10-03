/**
 * Sources whose bound-tree dumps are pinned in snapshots.json (SF-A02-T27, SF-A02-T28).
 * Each entry exercises the syntax kinds named in its id. Regenerate the pins with
 *   node packages/compiler/test/bound/update-snapshots.js
 */
import {SourceText} from '@sharpforge/text';
import {parse} from '@sharpforge/syntax';
import {Compilation} from '../../src/compilation.js';
import {dumpBoundTree} from '../../src/bound/dump.js';
const shapes='class Figure{public int Sides;public string Name{get;set;}public Figure(int sides){Sides=sides;}public int Twice(){return Sides*2;}public static int Count;static int Next(){Count++;return Count;}}';
export const boundFixtures=Object.freeze([
  ['expr-literal-name','int a=1;double d=2.5;bool b=true;string s="x";object o=null;Console.WriteLine(a);Console.WriteLine(d);Console.WriteLine(b);Console.WriteLine(s);Console.WriteLine(o);'],
  ['expr-member-call','var p=new Figure(3);Console.WriteLine(p.Sides);Console.WriteLine(p.Name);Console.WriteLine(p.Twice());Console.WriteLine(Figure.Count);string t="abc";Console.WriteLine(t.Length);Console.WriteLine(t.ToUpper());Console.WriteLine(Math.Max(1,2.5));'+shapes],
  ['expr-new-initializers','using System.Collections.Generic;'+'var p=new Figure(4){Name="square",Sides=4};var list=new List<int>{1,2};var e=new Exception("boom");Console.WriteLine(p.Name+list.Count+e.Message);'+shapes],
  ['expr-newarray-index','int[] a=new int[3];int[] b=new int[]{1,2,3};var c=new[]{"x","y"};a[0]=b[2];b[1]+=5;Console.WriteLine(a[0]+b[1]);Console.WriteLine(c[1]);Console.WriteLine(a.Length);'],
  ['expr-unary-binary','int a=5;int b=-a;bool c=!(a>b);int d=~a;a++;--b;double e=a/2.0;string s="n"+a;bool f=a==b||c&&e<3;int g=a<<2|b&3^1;Console.WriteLine(s+d+f+g);'],
  ['expr-assignment-forms','using System.Collections.Generic;'+'var p=new Figure(1);int x=0;x=3;x+=2;x*=4;p.Sides=x;p.Sides-=1;p.Name="n";Figure.Count=7;string s=null;s??="d";var d=new Dictionary<string,int>();d["k"]=1;d["k"]+=2;Console.WriteLine(x+p.Sides+s+d["k"]);'+shapes],
  ['expr-conditional-cast-default','int a=3;double d=a>2?1.5:2;int i=(int)d;double w=(double)a;int z=default(int);string n=default(string);string s=n??"none";Console.WriteLine(i+w+z);Console.WriteLine(s);'],
  ['expr-interpolated-nameof','int a=42;string s=$"a={a,5:D3} and {a+1}";Console.WriteLine(s);Console.WriteLine(nameof(a));'],
  ['expr-await','using System.Threading.Tasks;class P{static async Task<int> One(){await Task.Delay(1);return 1;}static async Task Main(){int v=await One();Console.WriteLine(v);}}'],
  ['expr-switch-checked','int k=2;string s=k switch{1=>"one",2=>"two",_=>"many"};int big=2147483647;int w=unchecked(big+1);Console.WriteLine(s+w);'],
  ['expr-delegate-event','using System;class P{static void Hello(){Console.WriteLine("hi");}static void Main(){Action b=new Action(Hello);b.Invoke();}}'],
  ['expr-collection-target-typed','using System.Collections.Generic;int[] a=[1,2];List<int> l=[0,..a,3];Box b=new();Console.WriteLine(l.Count+b.V);class Box{public int V;}'],
  ['stmt-block-local','{int a=1,b=2;const int K=3;var c=a+b+K;{string inner="x";Console.WriteLine(inner);}Console.WriteLine(c);}'],
  ['stmt-if-while-do-for','int i=0;if(i==0)i=1;else i=2;while(i<3)i++;do{i--;}while(i>0);for(int j=0;j<2;j++){if(j==1)continue;Console.WriteLine(j);}for(;;){break;}'],
  ['stmt-foreach','using System.Collections.Generic;int total=0;foreach(int v in new int[]{1,2})total+=v;var list=new List<string>();list.Add("a");foreach(var s in list){Console.WriteLine(s);}Console.WriteLine(total);'],
  ['stmt-switch','int k=2;switch(k){case 1:Console.WriteLine("one");break;case 2:case 3:Console.WriteLine("few");break;default:Console.WriteLine("many");break;}string s="a";switch(s){case "a":return;}'],
  ['stmt-try-throw','try{throw new Exception("x");}catch(Exception e){Console.WriteLine(e.Message);throw;}finally{Console.WriteLine("f");}'],
  ['stmt-try-catch-all','int n=0;try{n=1;}catch{n=2;}Console.WriteLine(n);'],
  ['stmt-using','using(R r=new R()){Console.WriteLine("in");}using(new R()){}using var last=new R();Console.WriteLine("end");class R:IDisposable{public void Dispose(){Console.WriteLine("d");}}'],
  ['stmt-return-break-continue','class P{static int First(int[] xs){foreach(int x in xs){if(x<0)continue;if(x>9)break;return x;}return -1;}static void Main(){Console.WriteLine(First(new int[]{-1,4}));}}'],
  ['stmt-checked-unchecked','int big=2147483647;checked{int a=big-1;Console.WriteLine(a+1);}unchecked{int b=big+1;Console.WriteLine(b);}'],
  ['stmt-labeled-conditional-access','N n=new N();n?.V=5;outer:for(int i=0;i<2;i++){for(int j=0;j<2;j++){if(j==1)continue outer;}}Console.WriteLine(n.V);class N{public int V;}',{langVersion:'preview'}],
  ['members-property-accessors','var c=new C();c.P++;Console.WriteLine(c.P+c.Auto);class C{int backing;public int P{get{return backing;}set{backing=value;}}public int Auto{get;}public C(){Auto=3;P=Auto+1;}}'],
  ['errors-are-bound-too','int x="text";Console.WriteLine(missing);x.Nope();int y=unknown+1;foo:;']
]);
/** Binds a fixture and returns `{diagnostics, methods:{[qualifiedName]:dump}}` for its declared methods. */
export function bindFixture(source,options={}){
  const compilation=new Compilation([parse(new SourceText(source,'Program.cs'))],{...options,pipeline:'bound'}),result=compilation.build(),methods={};
  for(const unit of compilation.boundPipeline.units)if(unit.kind==='body'&&unit.body&&!unit.method.name.startsWith('<startup>'))methods[unit.method.qualifiedName]=dumpBoundTree(unit.body);
  return {diagnostics:result.diagnostics.map(d=>`${d.code}@${d.start}+${d.length}`),methods,compilation};
}
