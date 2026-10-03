global using System;
global using System.Collections.Generic;
global using static System.Math;
global using Alias = System.Text.StringBuilder;
global using unsafe Ptr = int*;
global using static unsafe System.Runtime.CompilerServices.Unsafe;
using System.Linq;
using static System.Console;
using L = System.Collections.Generic.List<int>;

[assembly: A]

namespace A.B.C;

extern alias X;
using System.IO;
using M = System.Collections.Generic.Dictionary<string, int>;

class First { }
interface ISecond { }
struct Third { }
enum Fourth { A }
delegate void Fifth();
record Sixth(int A);
[Attr] public static partial class Seventh
{
    int global;
    int M() { int global = 1; return global; }
}
