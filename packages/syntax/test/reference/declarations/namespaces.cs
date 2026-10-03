extern alias Legacy;
using System;
using System.Collections.Generic;
using static System.Math;
using IO = System.IO;
using Map = System.Collections.Generic.Dictionary<string, int>;
using Pair = (int Left, int Right);
using unsafe IntPtrAlias = int*;
[assembly: System.Reflection.AssemblyTitle("Fixture")]
[module: System.CLSCompliant(false)]

namespace Outer
{
    using System.Text;

    namespace Inner.Deep
    {
        extern alias Legacy;
        using Legacy::Old;

        class A { }
    }

    namespace Sibling { class B { } }

    class C { global::System.Int32 value; }
}

namespace Dotted.Name.Space
{
    class D { }
};
