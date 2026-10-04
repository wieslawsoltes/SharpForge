/**
 * Differential fixtures for SF-A02-T73 (C# 9 function pointers): `delegate*` types and calling conventions, `&Method`
 * conversions, invocation, comparison and `[UnmanagedCallersOnly]`. Function pointers are not executable on the
 * runtime, so every fixture pins diagnostics.
 */
import { cs, diag, feature } from './kit.js';

const unsafe = { allowUnsafe: true };

export const fixtures = feature('function-pointers', [
  diag(
    'valid-uses-warn-on-comparison',
    cs`
      using System;
      using System.Runtime.InteropServices;
      unsafe class Program
      {
          static int Add(int a, int b) => a + b;
          static void Log(string s) { }
          static void Log(int i) { }
          static string Text(object o) => "t";
          [UnmanagedCallersOnly] static int Native(int a) => a;
          static delegate*<int, int, int> field;
          static delegate*<int, int, int> Pick(delegate*<int, int, int> p) => p;
          static void Main()
          {
              delegate*<int, int, int> add = &Add;
              delegate* managed<int, int, int> same = add;
              delegate*<string, void> log = &Log;
              delegate*<object, object> covariant = &Text;
              delegate* unmanaged<int, int> native = &Native;
              delegate* unmanaged[Cdecl, SuppressGCTransition]<int, int> conventions = null;
              delegate*<ref int, out int, in int, void> refs = null;
              void* raw = add;
              delegate*<int, int, int> back = (delegate*<int, int, int>)raw;
              delegate*<int, int> cast = (delegate*<int, int>)add;
              field = Pick(add);
              int sum = add(1, 2) + field(3, 4) + native(5) + sizeof(delegate*<int>);
              log("x");
              Console.WriteLine(add == same);
              Console.WriteLine(add != null);
          }
      }
    `,
    unsafe,
  ),
  diag(
    'conversion-and-invocation-errors',
    cs`
      using System;
      using System.Runtime.InteropServices;
      unsafe class Program
      {
          static int Add(int a, int b) => a + b;
          static void Log(string s) { }
          static void Log(int i) { }
          int Instance(int a) => a;
          static object Boxed(string s) => s;
          [UnmanagedCallersOnly] static int Native(int a) => a;
          static void Main()
          {
              delegate*<int, int, int> add = &Add;
              delegate*<long, void> none = &Log;
              delegate*<int, int> inst = &Instance;
              delegate*<object, object> contra = &Boxed;
              delegate*<string, string> wrongReturn = &Boxed;
              delegate* unmanaged[Cdecl]<int, int> cdecl = &Native;
              delegate* unmanaged[Nope]<int, int> unknown = null;
              delegate*<int, int> managedNative = &Native;
              delegate*<int, int> other = add;
              int direct = Native(1);
              var inferred = &Add;
              add(1);
              add(1, "x");
              Func<int, int, int> f = add;
              add.Invoke(1, 2);
          }
      }
      class Safe { static void M() { delegate*<int> p = null; } }
    `,
    unsafe,
  ),
  diag(
    'unmanaged-callers-only-rules',
    cs`
      using System.Runtime.InteropServices;
      class Program
      {
          [UnmanagedCallersOnly] static void Managed(string s, object o) { }
          [UnmanagedCallersOnly] static string Returns() => null;
          [UnmanagedCallersOnly] int NotStatic() => 0;
          [UnmanagedCallersOnly] static void Generic<T>() { }
          [UnmanagedCallersOnly] static void ByRef(ref int value) { }
          [UnmanagedCallersOnly] static int Fine(int a, double b) => a;
          static void Main() { Fine(1, 2); }
      }
      class Outer<T> { [UnmanagedCallersOnly] static void Inner() { } }
    `,
  ),
]);
