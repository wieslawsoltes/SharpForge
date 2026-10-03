using System;
using System.Threading.Tasks;

Console.WriteLine("hello");
int x = 1;
var y = x + 1;
if (args.Length > 0) Console.WriteLine(args[0]);
await Task.Delay(1);
int Twice(int v) => v * 2;
static void Helper() { }
async Task Run() { await Task.Yield(); }
[Obsolete] void Old() { }
for (int i = 0; i < 3; i++) { }
foreach (var a in args) { }
using var d = F();
await using var e = G();
await foreach (var item in items) { }
try { } catch { }
label: x++;
goto label;
{ int nested = 1; }
unsafe { }
checked { x++; }
lock (o) { }
x = y switch { 1 => 2, _ => 3 };
(int p, int q) = (1, 2);
var (r, s) = (3, 4);
Func<int, int> f = v => v + 1;
T Generic<T>(T t) => t;
ref int R() => ref x;
dynamic dyn = 1;
return 0;

namespace N
{
    class C { }
}
class D
{
    void M() { }
}
record R2(int A);
enum E { A }
interface I { }
struct S { }
delegate void Del();
partial class P { }
