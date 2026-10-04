/**
 * Differential fixtures for COM interop in the language (C# 4, SF-A02-T56): on a method of a `[ComImport]` interface
 * `ref` may be omitted (`out` may not, and the argument must convert), `new I()` creates the coclass of a COM
 * interface, and the declaration rules of `[ComImport]` types. Binding only: nothing here runs.
 */
import { cs, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('com-interop', [
    diag(
      'cs1620-cs0144-ref-omission-and-coclass-creation',
      cs`
        using System;
        using System.Runtime.InteropServices;
        [ComImport, Guid("00000000-0000-0000-0000-000000000001"), CoClass(typeof(WidgetClass))]
        interface IWidget
        {
            void Update(ref int value, ref string name);
            int Read(ref object index);
            void Out(out int value);
            void In(in int value);
        }
        [ComImport, Guid("00000000-0000-0000-0000-000000000002")]
        class WidgetClass { }
        interface IPlain { void Update(ref int value); }
        class Impl : IPlain { public void Update(ref int value) { } }
        [ComImport, Guid("00000000-0000-0000-0000-000000000003")]
        interface INoCoClass { }
        class Program
        {
            static void Main()
            {
                IWidget w = new IWidget();
                int i = 1; string s = "a"; object o = 1;
                w.Update(i, s);
                w.Update(ref i, s);
                w.Update(1, "literal");
                w.Update(i + 1, name: s);
                int r = w.Read(0) + w.Read(o) + w.Read("x");
                w.Out(i);
                w.In(i);
                w.Update(o, s);
                IPlain p = new Impl();
                p.Update(i);
                var n = new INoCoClass();
                var q = new IPlain();
            }
        }
      `,
    ),
    diag(
      'cs0596-cs0423-cs0424-cs0669-cs0591-comimport-declarations',
      cs`
        using System;
        using System.Runtime.InteropServices;
        [ComImport]
        interface INoGuid { }
        [ComImport, Guid("00000000-0000-0000-0000-000000000004")]
        class ComClass
        {
            public ComClass() { }
            public void M() { }
            public extern void N();
            int field;
        }
        [ComImport, Guid("00000000-0000-0000-0000-000000000005")]
        class Derived : Base { }
        class Base { }
        [ComImport, Guid("00000000-0000-0000-0000-000000000006")]
        struct S { }
        [Guid("not-a-guid")]
        class BadGuid { }
        [CoClass(typeof(int))]
        interface IAttr { }
        class Program { static void Main() { var c = new ComClass(); } }
      `,
    ),
  ]),
];
