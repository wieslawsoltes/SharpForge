/**
 * Differential fixtures for SF-A02-T02 (polymorphic recursion): generic code that asks for constructions of itself.
 * A cycle whose type arguments do not grow has a finite set of constructions and runs; a cycle that grows has none
 * (.NET creates the constructions at run time) and is refused with SF2200: the fixture of the second feature
 * records that gap.
 * The pinned output is what the same program prints on .NET.
 */
import { cs, out, feature } from './kit.js';

const box = `
    class Box<T>
    {
        public T Value;
        public Box(T value) { Value = value; }
        public Box<Box<T>> Wrap() { return new Box<Box<T>>(this); }
    }`;

const finite = feature('polymorphic-recursion', [
  out(
    'cycles-with-a-finite-set-of-constructions',
    cs`
    using System;
    ${box}
    class Flip<A, B>
    {
        public A Left;
        public B Right;
        public Flip(A left, B right) { Left = left; Right = right; }
        public Flip<B, A> Turn() { return new Flip<B, A>(Right, Left); }
        public string Show(int turns) { return turns == 0 ? "" + Left + Right : Turn().Show(turns - 1); }
    }
    class Program
    {
        static string Swap<A, B>(A a, B b, int n) { return n == 0 ? "" + a + b : Swap(b, a, n - 1); }
        static int Collapse<T>(T x, int n) { return n == 0 ? 0 : 1 + Collapse(7, n - 1); }
        static int Fixed<T>(T x, int n) { return n == 0 ? 0 : 1 + Fixed(new Box<int>(1), n - 1); }
        static int Depth(int x) { return 0; }
        static int Depth<T>(Box<T> box, Func<T, int> rest) { return 1 + rest(box.Value); }
        static int Even<T>(T x, int n) { return n == 0 ? 0 : Odd(x, n - 1); }
        static int Odd<U>(U y, int n) { return n == 0 ? 1 : Even(y, n - 1); }
        static void Main()
        {
            Console.WriteLine(Swap(1, "s", 3) + " " + Swap(1, "s", 4));
            Console.WriteLine(Collapse("s", 3) + " " + Fixed("s", 3));
            Console.WriteLine(Depth(new Box<Box<int>>(new Box<int>(1)), inner => Depth(inner, Depth)));
            Console.WriteLine(Even("e", 5) + " " + Even(2, 4));
            Console.WriteLine(new Flip<int, string>(1, "f").Show(3));
        }
    }
  `,
  ),
  out(
    'deep-constructions-without-a-cycle',
    cs`
    using System;
    ${box}
    class Program
    {
        static int L0<T>(T x) { return L1(new Box<T>(x)); }
        static int L1<T>(T x) { return L2(new Box<T>(x)); }
        static int L2<T>(T x) { return L3(new Box<T>(x)); }
        static int L3<T>(T x) { return L4(new Box<T>(x)); }
        static int L4<T>(T x) { return L5(new Box<T>(x)); }
        static int L5<T>(T x) { return L6(new Box<T>(x)); }
        static int L6<T>(T x) { return L7(new Box<T>(x)); }
        static int L7<T>(T x) { return L8(new Box<T>(x)); }
        static int L8<T>(T x) { return L9(new Box<T>(x)); }
        static int L9<T>(T x) { return L10(new Box<T>(x)); }
        static int L10<T>(T x) { return L11(new Box<T>(x)); }
        static int L11<T>(T x) { return L12(new Box<T>(x)); }
        static int L12<T>(T x) { return L13(new Box<T>(x)); }
        static int L13<T>(T x) { return L14(new Box<T>(x)); }
        static int L14<T>(T x) { return 14; }
        static void Main()
        {
            Console.WriteLine(L0(1));
            var b2 = new Box<int>(7).Wrap().Wrap();
            var b4 = b2.Wrap().Wrap();
            var b6 = b4.Wrap().Wrap();
            var b8 = b6.Wrap().Wrap();
            var b10 = b8.Wrap().Wrap();
            var b12 = b10.Wrap().Wrap();
            var b14 = b12.Wrap().Wrap();
            var b16 = b14.Wrap().Wrap();
            var v12 = b16.Value.Value.Value.Value;
            var v8 = v12.Value.Value.Value.Value;
            var v4 = v8.Value.Value.Value.Value;
            Console.WriteLine(v4.Value.Value.Value.Value.Value);
        }
    }
  `,
  ),
  out(
    'a-growing-call-behind-a-constant-that-is-false',
    cs`
    using System;
    ${box}
    class Program
    {
        const bool Deep = false;
        static int Guarded<T>(T x, int n)
        {
            if (Deep) return Guarded(new Box<T>(x), n - 1);
            return n;
        }
        static int Other<T>(T x)
        {
            if (true) return 1;
            else return Other(new Box<T>(x));
        }
        static void Main()
        {
            Console.WriteLine(Guarded(1, 3) + Other("s"));
        }
    }
  `,
  ),
]);

/** Valid C# that .NET runs and monomorphization cannot: kept in the corpus as a recorded gap. */
const atRunTime = feature('polymorphic-recursion-at-run-time', [
  out(
    'a-growing-cycle-that-ends-at-run-time',
    cs`
    using System;
    ${box}
    class Program
    {
        static int Depth<T>(T x, int n) { return n == 0 ? 0 : 1 + Depth(new Box<T>(x), n - 1); }
        static void Main()
        {
            Console.WriteLine(Depth(1, 3));
        }
    }
  `,
  ),
]);

export const fixtures = [...finite, ...atRunTime];
