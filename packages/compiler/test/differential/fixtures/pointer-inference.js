/** Generic pointer inference and pointer-shaped output dependencies; all programs are pinned with /unsafe. */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = feature('pointer-inference', [
  out('pointees-and-function-pointer-signatures', cs`
    using System;
    unsafe class Program
    {
        static string Pointee<T>(T* value) where T : unmanaged => typeof(T).Name;
        static string Nested<T>(T** value) where T : unmanaged => typeof(T).Name;
        static string Binary<T>(delegate*<T, T, T> operation) => typeof(T).Name;
        static void Main()
        {
            int value = 1;
            int* address = &value;
            delegate*<string, string, string> operation = null;
            Console.WriteLine(Pointee(address));
            Console.WriteLine(Nested(&address));
            Console.WriteLine(Binary(operation));
        }
    }
  `, { allowUnsafe: true }),
  diag('raw-pointer-output-has-no-type-bound', cs`
    unsafe delegate T* Maker<T>() where T : unmanaged;
    unsafe delegate T*[] Makers<T>() where T : unmanaged;
    unsafe delegate delegate*<T> Getter<T>();
    unsafe class Program
    {
        static void Factory<T>(Maker<T> factory) where T : unmanaged { }
        static void Many<T>(Makers<T> factory) where T : unmanaged { }
        static void Function<T>(Getter<T> factory) { }
        static short* Make() => null;
        static short*[] MakeMany() => null;
        static delegate*<int> MakeFunction() => null;
        static void Main()
        {
            Factory(() => (short*)null);
            Factory(Make);
            Many(MakeMany);
            Function(MakeFunction);
        }
    }
  `, { allowUnsafe: true }),
  out('reference-variance-and-convention-order', cs`
    using System;
    unsafe class Program
    {
        static string Output<T>(delegate*<T> factory, T value) => typeof(T).Name;
        static string Input<T>(delegate*<T, void> consumer, T value) => typeof(T).Name;
        static string Native<T>(delegate* unmanaged[SuppressGCTransition, Cdecl]<T> factory) => typeof(T).Name;
        static void Main()
        {
            delegate*<string> factory = null;
            delegate*<object, void> consumer = null;
            delegate* unmanaged[Cdecl, SuppressGCTransition]<int> native = null;
            Console.WriteLine(Output(factory, new object()));
            Console.WriteLine(Input(consumer, "text"));
            Console.WriteLine(Native(native));
        }
    }
  `, { allowUnsafe: true }),
  diag('invariant-pointees-and-value-slots', cs`
    unsafe class Program
    {
        static void Same<T>(T* first, T* second) where T : unmanaged { }
        static void Output<T>(delegate*<T> factory, T value) { }
        static void Reference<T>(delegate*<ref T> factory, T value) { }
        static void Main()
        {
            int* first = null;
            long* second = null;
            delegate*<int> factory = null;
            delegate*<ref string> reference = null;
            Same(first, second);
            Output(factory, 1L);
            Reference(reference, new object());
        }
    }
  `, { allowUnsafe: true }),
  diag('signature-shape-mismatch', cs`
    unsafe class Program
    {
        static void Managed<T>(delegate*<T> factory) { }
        static void Native<T>(delegate* unmanaged[Cdecl]<T> factory) { }
        static void Argument<T>(delegate*<T, void> consumer) { }
        static void Main()
        {
            delegate* unmanaged[Cdecl]<int> native = null;
            delegate* unmanaged[Stdcall]<int> other = null;
            delegate*<ref int> reference = null;
            delegate*<ref int, void> byReference = null;
            Managed(native);
            Native(other);
            Managed(reference);
            Argument(byReference);
        }
    }
  `, { allowUnsafe: true }),
]);
