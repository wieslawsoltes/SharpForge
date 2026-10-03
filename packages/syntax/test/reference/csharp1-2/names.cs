extern alias Lib;
extern alias Other;
using System;
using Col = System.Collections.Generic;
using IntList = System.Collections.Generic.List<int>;
using G = global::System;

namespace N.M
{
    extern alias Inner;
    using Lib::Company.Types;

    class Names : global::System.Object, Lib::Base<int>, Col::IEnumerable<Lib::Item>
    {
        global::System.Int32 a;
        Lib::Company.Widget b;
        Col::List<global::System.String> c;
        Lib::Outer<int>.Inner<Other::T> d;
        global::System.Int32 M(Lib::Arg x)
        {
            var v = global::System.Console.Out;
            Lib::Company.Widget.Create();
            var t = typeof(Lib::Company.Widget);
            var n = new Col::List<int>();
            var o = x as Lib::Thing;
            var p = (global::System.Object)x;
            var q = G::Math.Max(1, 2) + global::System.Math.Abs(-1);
            int global = 1; global++; int alias = 2; alias += global;
            return global::N.M.Names.Zero;
        }
        void Lib::IFace.Explicit() { }
        [global::System.Obsolete] event global::System.EventHandler E;
    }
}
