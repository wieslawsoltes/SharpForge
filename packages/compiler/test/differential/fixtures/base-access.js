/**
 * Differential fixtures for SF-A02-T30: what a `base.` access reaches when the member is overridden more than once -
 * the override nearest to the base class, for methods, properties, indexers and events - and when an abstract
 * declaration lies further up (no CS0205 while the nearest override has a body).
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('base-access', [
    out(
      'base-reaches-the-nearest-override',
      cs`
    using System;
    abstract class Shape
    {
        public abstract int Area(int scale);
        public virtual string Name() { return "shape"; }
        public virtual int Value { get { return 1; } set { } }
        public virtual int this[int i] { get { return i; } }
        public virtual event Action Changed { add { Console.WriteLine("shape add"); } remove { } }
        public override string ToString() { return "S"; }
    }
    class Square : Shape
    {
        int v = 5;
        public override int Area(int scale) { return scale * scale; }
        public override string Name() { return "square"; }
        public override int Value { get { return v; } set { v = value; } }
        public override int this[int i] { get { return i * 10; } }
        public override event Action Changed { add { Console.WriteLine("square add"); } remove { } }
        public override string ToString() { return "Q" + base.ToString(); }
    }
    class Middle : Square { }
    class Cube : Middle
    {
        public override int Area(int scale) { return base.Area(scale) * scale; }
        public override string Name() { return base.Name() + "+cube"; }
        public override int Value { get { return base.Value + 100; } set { base.Value = value * 2; } }
        public override int this[int i] { get { return base[i] + 1; } }
        public override event Action Changed { add { base.Changed += value; Console.WriteLine("cube add"); } remove { } }
        public override string ToString() { return "C" + base.ToString(); }
        public Func<string> Deferred() { return () => base.Name(); }
    }
    class Program
    {
        static void Main()
        {
            var cube = new Cube { Value = 3 };
            Console.WriteLine(cube.Area(2) + " " + cube.Name() + " " + cube.Value + " " + cube[4] + " " + cube);
            cube.Changed += () => { };
            Console.WriteLine(cube.Deferred()() + " " + new Middle()[4] + " " + new Middle().Name());
        }
    }
  `,
    ),
    diag(
      'cs0205-only-when-the-nearest-override-is-abstract',
      cs`
    abstract class Shape { public abstract int Area(); public abstract int Size { get; } }
    abstract class Mid : Shape { public abstract override int Area(); }
    class Direct : Shape
    {
        public override int Area() { return base.Area(); }
        public override int Size { get { return base.Size; } }
    }
    class Deep : Mid
    {
        public override int Area() { return base.Area(); }
        public override int Size { get { return 1; } }
    }
    class Concrete : Shape { public override int Area() { return 1; } public override int Size { get { return 2; } } }
    class Fine : Concrete { public override int Area() { return base.Area() + base.Size; } }
    class Program { static void Main() { System.Console.WriteLine(new Fine().Area()); } }
  `,
    ),
  ]),
];
