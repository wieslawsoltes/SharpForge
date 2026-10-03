/** Differential fixtures: classes, properties, methods, inheritance, interfaces, structs, enums, generics, name lookup. */
import {cs,out,diag,feature} from './kit.js';

export const fixtures=[
...feature('classes',[
  out('fields-ctor-methods',cs`
    using System;
    var p = new Point(3, 4);
    Console.WriteLine(p.X + "," + p.Y);
    p.Move(1, -1);
    Console.WriteLine(p.LengthSquared());
    class Point
    {
        public int X;
        public int Y;
        public Point(int x, int y) { X = x; Y = y; }
        public void Move(int dx, int dy) { X += dx; Y += dy; }
        public int LengthSquared() { return X * X + Y * Y; }
    }
  `),
  out('static-members',cs`
    using System;
    new Counter(); new Counter(); new Counter();
    Console.WriteLine(Counter.Count);
    Console.WriteLine(Counter.Describe());
    class Counter
    {
        public static int Count;
        public Counter() { Count++; }
        public static string Describe() { return "count=" + Count; }
    }
  `),
  out('constructor-chaining',cs`
    using System;
    Console.WriteLine(new Box().Describe());
    Console.WriteLine(new Box(2).Describe());
    Console.WriteLine(new Box(2, 3).Describe());
    class Box
    {
        int w, h;
        public Box() : this(1) { }
        public Box(int size) : this(size, size) { }
        public Box(int w, int h) { this.w = w; this.h = h; }
        public string Describe() { return w + "x" + h; }
    }
  `),
  out('tostring-override',cs`
    using System;
    var m = new Money(5, "EUR");
    Console.WriteLine(m);
    Console.WriteLine("total: " + m);
    Console.WriteLine($"{m}!");
    object o = m;
    Console.WriteLine(o.ToString());
    class Money
    {
        int amount; string currency;
        public Money(int amount, string currency) { this.amount = amount; this.currency = currency; }
        public override string ToString() { return amount + " " + currency; }
    }
  `),
  out('object-initializer',cs`
    using System;
    var p = new Person { Name = "Ann", Age = 30 };
    var q = new Person("Bob") { Age = 41 };
    Console.WriteLine(p.Name + " " + p.Age);
    Console.WriteLine(q.Name + " " + q.Age);
    class Person
    {
        public string Name;
        public int Age;
        public Person() { }
        public Person(string name) { Name = name; }
    }
  `),
  out('reference-semantics',cs`
    using System;
    var a = new Node { Value = 1 };
    var b = a;
    b.Value = 2;
    Console.WriteLine(a.Value);
    Console.WriteLine(a == b);
    Console.WriteLine(a == new Node { Value = 2 });
    Node none = null;
    Console.WriteLine(none == null);
    class Node { public int Value; public Node Next; }
  `),
  out('nested-and-static-class',cs`
    using System;
    Console.WriteLine(Util.Twice(21));
    var i = new Outer.Inner();
    Console.WriteLine(i.Name());
    static class Util { public static int Twice(int x) => x * 2; }
    class Outer
    {
        public class Inner { public string Name() { return "inner"; } }
    }
  `),
  out('linked-list',cs`
    using System;
    Node head = null;
    for (int i = 3; i >= 1; i--) head = new Node(i, head);
    int sum = 0;
    for (Node n = head; n != null; n = n.Next) { Console.Write(n.Value + " "); sum += n.Value; }
    Console.WriteLine();
    Console.WriteLine(sum);
    class Node
    {
        public int Value; public Node Next;
        public Node(int value, Node next) { Value = value; Next = next; }
    }
  `),
  out('field-initializers-and-defaults',cs`
    using System;
    var d = new Defaults();
    Console.WriteLine(d.Number);
    Console.WriteLine(d.Flag);
    Console.WriteLine(d.Text == null);
    Console.WriteLine(d.Ratio);
    Console.WriteLine(d.Preset);
    class Defaults
    {
        public int Number; public bool Flag; public string Text; public double Ratio;
        public int Preset = 7 * 6;
    }
  `),
  diag('cs1729-no-matching-constructor',cs`
    using System;
    var p = new P(1, 2);
    Console.WriteLine(p);
    class P { public P(int x) { } }
  `),
  diag('cs0144-instantiate-abstract',cs`
    using System;
    var s = new Shape();
    Console.WriteLine(s);
    abstract class Shape { }
  `),
  diag('cs0120-instance-member-from-static',cs`
    using System;
    class C
    {
        int value = 1;
        static void Main() { Console.WriteLine(value); }
    }
  `),
  diag('cs0120-instance-method-from-static',cs`
    using System;
    class C
    {
        void Hello() { Console.WriteLine("hi"); }
        static void Main() { Hello(); }
    }
  `),
  diag('cs0176-static-through-instance',cs`
    using System;
    var c = new C();
    Console.WriteLine(c.Count);
    class C { public static int Count = 1; }
  `),
  diag('cs0026-this-in-static',cs`
    using System;
    class C
    {
        int v = 1;
        static void Main() { Console.WriteLine(this.v); }
    }
  `),
  diag('cs0708-instance-member-in-static-class',cs`
    using System;
    Console.WriteLine(1);
    static class S { public int X; }
  `),
]),
...feature('properties',[
  out('auto-properties',cs`
    using System;
    var p = new Person("Ann") { Age = 30 };
    p.Age++;
    Console.WriteLine(p.Name + " " + p.Age);
    Console.WriteLine(p.Nick);
    class Person
    {
        public string Name { get; }
        public int Age { get; set; }
        public string Nick { get; set; } = "none";
        public Person(string name) { Name = name; }
    }
  `),
  out('computed-and-validated',cs`
    using System;
    var r = new Rect { Width = 3, Height = 4 };
    Console.WriteLine(r.Area);
    r.Width = -5;
    Console.WriteLine(r.Width);
    Console.WriteLine(r.Area);
    class Rect
    {
        int width;
        public int Width { get { return width; } set { width = value < 0 ? 0 : value; } }
        public int Height { get; set; }
        public int Area => Width * Height;
    }
  `),
  out('static-property',cs`
    using System;
    Settings.Level = 3;
    Settings.Level += 2;
    Console.WriteLine(Settings.Level);
    Console.WriteLine(Settings.Label);
    class Settings
    {
        public static int Level { get; set; }
        public static string Label => "level " + Level;
    }
  `),
  out('indexer',cs`
    using System;
    var g = new Grid(2, 3);
    g[1, 2] = 9;
    g[0, 0] = 4;
    Console.WriteLine(g[1, 2] + g[0, 0]);
    Console.WriteLine(g[0, 1]);
    class Grid
    {
        int[] cells; int w;
        public Grid(int h, int w) { this.w = w; cells = new int[h * w]; }
        public int this[int r, int c] { get { return cells[r * w + c]; } set { cells[r * w + c] = value; } }
    }
  `),
  out('init-only',cs`
    using System;
    var p = new Point { X = 1, Y = 2 };
    Console.WriteLine(p.X + p.Y);
    class Point
    {
        public int X { get; init; }
        public int Y { get; init; }
    }
  `),
  diag('cs0200-assign-get-only',cs`
    using System;
    var p = new P();
    p.Value = 3;
    Console.WriteLine(p.Value);
    class P { public int Value { get; } }
  `),
  diag('cs0154-no-get-accessor',cs`
    using System;
    var p = new P();
    Console.WriteLine(p.Value);
    class P { int v; public int Value { set { v = value; } } }
  `),
  diag('cs0272-private-setter',cs`
    using System;
    var p = new P();
    p.Value = 3;
    Console.WriteLine(p.Value);
    class P { public int Value { get; private set; } }
  `),
  diag('cs8852-init-only-assignment',cs`
    using System;
    var p = new P { Value = 1 };
    p.Value = 3;
    Console.WriteLine(p.Value);
    class P { public int Value { get; init; } }
  `),
  diag('cs0029-property-type-mismatch',cs`
    using System;
    var p = new P();
    p.Name = 5;
    Console.WriteLine(p.Name);
    class P { public string Name { get; set; } }
  `),
]),
...feature('methods',[
  out('recursion',cs`
    using System;
    int Fib(int n) { return n < 2 ? n : Fib(n - 1) + Fib(n - 2); }
    int Gcd(int a, int b) { return b == 0 ? a : Gcd(b, a % b); }
    Console.WriteLine(Fib(15));
    Console.WriteLine(Gcd(84, 36));
  `),
  out('ref-and-out',cs`
    using System;
    void Swap(ref int a, ref int b) { int t = a; a = b; b = t; }
    bool TryHalf(int v, out int half) { half = v / 2; return v % 2 == 0; }
    int x = 1, y = 2;
    Swap(ref x, ref y);
    Console.WriteLine(x + " " + y);
    Console.WriteLine(TryHalf(10, out int h) + " " + h);
    Console.WriteLine(TryHalf(7, out h) + " " + h);
  `),
  out('optional-and-named',cs`
    using System;
    string Greet(string name, string greeting = "Hello", int times = 1)
    {
        string s = "";
        for (int i = 0; i < times; i++) s += greeting + " " + name + ";";
        return s;
    }
    Console.WriteLine(Greet("Ann"));
    Console.WriteLine(Greet("Bob", "Hi"));
    Console.WriteLine(Greet("Cy", times: 2));
    Console.WriteLine(Greet(greeting: "Yo", name: "Di"));
  `),
  out('params-array',cs`
    using System;
    int Sum(params int[] values) { int s = 0; foreach (int v in values) s += v; return s; }
    Console.WriteLine(Sum());
    Console.WriteLine(Sum(1));
    Console.WriteLine(Sum(1, 2, 3));
    Console.WriteLine(Sum(new[] { 4, 5 }));
  `),
  out('expression-bodied-and-local',cs`
    using System;
    class Program
    {
        static int Square(int x) => x * x;
        static void Main()
        {
            int Add(int a, int b) => a + b;
            int factor = 3;
            int Scale(int v) { return v * factor; }
            Console.WriteLine(Square(Add(2, 3)));
            Console.WriteLine(Scale(4));
        }
    }
  `),
  out('value-vs-reference-arguments',cs`
    using System;
    void ChangeInt(int v) { v = 99; }
    void ChangeArray(int[] a) { a[0] = 99; }
    void Replace(int[] a) { a = new int[] { 7 }; }
    int n = 1; int[] xs = { 1 };
    ChangeInt(n); Console.WriteLine(n);
    ChangeArray(xs); Console.WriteLine(xs[0]);
    Replace(xs); Console.WriteLine(xs[0]);
  `),
  diag('cs0127-return-value-from-void',cs`
    using System;
    class C
    {
        static void F() { return 1; }
        static void Main() { F(); }
    }
  `),
  diag('cs0126-return-without-value',cs`
    using System;
    class C
    {
        static int F() { return; }
        static void Main() { Console.WriteLine(F()); }
    }
  `),
  diag('cs0029-void-result-assigned',cs`
    using System;
    class C
    {
        static void F() { }
        static void Main() { int x = F(); Console.WriteLine(x); }
    }
  `),
  diag('cs1620-missing-ref',cs`
    using System;
    class C
    {
        static void Bump(ref int v) { v++; }
        static void Main() { int x = 1; Bump(x); Console.WriteLine(x); }
    }
  `),
  diag('cs0501-missing-body',cs`
    using System;
    class C
    {
        static int F();
        static void Main() { Console.WriteLine(1); }
    }
  `),
]),
...feature('overload-resolution',[
  out('int-double-string-object',cs`
    using System;
    class Program
    {
        static string F(int x) => "int";
        static string F(double x) => "double";
        static string F(string x) => "string";
        static string F(object x) => "object";
        static void Main()
        {
            Console.WriteLine(F(1));
            Console.WriteLine(F(1.5));
            Console.WriteLine(F("s"));
            Console.WriteLine(F(true));
            Console.WriteLine(F('c'));
            Console.WriteLine(F(1L));
            Console.WriteLine(F(null));
        }
    }
  `),
  out('arity-and-params',cs`
    using System;
    class Program
    {
        static string F() => "none";
        static string F(int a) => "one";
        static string F(int a, int b) => "two";
        static string F(params int[] rest) => "params " + rest.Length;
        static void Main()
        {
            Console.WriteLine(F());
            Console.WriteLine(F(1));
            Console.WriteLine(F(1, 2));
            Console.WriteLine(F(1, 2, 3));
        }
    }
  `),
  out('derived-preferred',cs`
    using System;
    class Animal { }
    class Dog : Animal { }
    class Program
    {
        static string F(Animal a) => "animal";
        static string F(Dog d) => "dog";
        static void Main()
        {
            Animal a = new Dog();
            Console.WriteLine(F(new Dog()));
            Console.WriteLine(F(a));
            Console.WriteLine(F(new Animal()));
        }
    }
  `),
  out('optional-vs-exact',cs`
    using System;
    class Program
    {
        static string F(int a) => "exact";
        static string F(int a, int b = 0) => "optional";
        static string G(long a) => "long";
        static string G(double a) => "double";
        static void Main()
        {
            Console.WriteLine(F(1));
            Console.WriteLine(F(1, 2));
            Console.WriteLine(G(1));
        }
    }
  `),
  diag('cs1501-no-overload-takes',cs`
    using System;
    class C
    {
        static int F(int a) { return a; }
        static void Main() { Console.WriteLine(F(1, 2)); }
    }
  `),
  diag('cs1503-argument-type',cs`
    using System;
    class C
    {
        static int F(int a) { return a; }
        static void Main() { Console.WriteLine(F("one")); }
    }
  `),
  diag('cs7036-missing-required-argument',cs`
    using System;
    class C
    {
        static int F(int a, int b) { return a + b; }
        static void Main() { Console.WriteLine(F(1)); }
    }
  `),
  diag('cs0121-ambiguous-call',cs`
    using System;
    class C
    {
        static void F(int a, double b) { }
        static void F(double a, int b) { }
        static void Main() { F(1, 1); Console.WriteLine(1); }
    }
  `),
  diag('cs1739-no-parameter-named',cs`
    using System;
    class C
    {
        static int F(int a) { return a; }
        static void Main() { Console.WriteLine(F(b: 1)); }
    }
  `),
  diag('cs1503-second-argument',cs`
    using System;
    class C
    {
        static void F(string s, int n) { }
        static void Main() { F("a", "b"); Console.WriteLine(1); }
    }
  `),
  diag('cs7036-constructor',cs`
    using System;
    var p = new P();
    Console.WriteLine(p);
    class P { public P(int x) { } }
  `),
  diag('cs1501-library-method',cs`
    using System;
    Console.WriteLine("abc".Substring(1, 2, 3));
  `),
]),
...feature('inheritance',[
  out('virtual-override',cs`
    using System;
    Shape[] shapes = { new Circle(1), new Square(2), new Shape() };
    foreach (Shape s in shapes) Console.WriteLine(s.Name() + " " + s.Area());
    class Shape
    {
        public virtual string Name() { return "shape"; }
        public virtual double Area() { return 0; }
    }
    class Circle : Shape
    {
        double r;
        public Circle(double r) { this.r = r; }
        public override string Name() { return "circle"; }
        public override double Area() { return 3 * r * r; }
    }
    class Square : Shape
    {
        double s;
        public Square(double s) { this.s = s; }
        public override string Name() { return "square"; }
        public override double Area() { return s * s; }
    }
  `),
  out('base-calls',cs`
    using System;
    var d = new Derived("x");
    Console.WriteLine(d.Describe());
    class Base
    {
        protected string tag;
        public Base(string tag) { this.tag = tag; Console.WriteLine("base ctor"); }
        public virtual string Describe() { return "base:" + tag; }
    }
    class Derived : Base
    {
        public Derived(string tag) : base(tag + "!") { Console.WriteLine("derived ctor"); }
        public override string Describe() { return "derived>" + base.Describe(); }
    }
  `),
  out('abstract-class',cs`
    using System;
    Animal a = new Dog();
    Console.WriteLine(a.Speak());
    Console.WriteLine(a.Intro());
    abstract class Animal
    {
        public abstract string Speak();
        public string Intro() { return "I say " + Speak(); }
    }
    class Dog : Animal
    {
        public override string Speak() { return "woof"; }
    }
  `),
  out('type-tests-and-casts',cs`
    using System;
    Base b = new Derived();
    Console.WriteLine(b is Derived);
    Console.WriteLine(b is Base);
    Console.WriteLine(new Base() is Derived);
    Derived d = (Derived)b;
    Console.WriteLine(d.Extra());
    try { Derived bad = (Derived)new Base(); Console.WriteLine(bad.Extra()); }
    catch (InvalidCastException) { Console.WriteLine("invalid cast"); }
    Console.WriteLine(b.GetType().Name);
    class Base { }
    class Derived : Base { public int Extra() { return 7; } }
  `),
  out('new-hides-member',cs`
    using System;
    Derived d = new Derived();
    Base b = d;
    Console.WriteLine(d.Name());
    Console.WriteLine(b.Name());
    class Base { public string Name() { return "base"; } }
    class Derived : Base { public new string Name() { return "derived"; } }
  `),
  diag('cs0115-no-method-to-override',cs`
    using System;
    Console.WriteLine(1);
    class A { }
    class B : A { public override void F() { } }
  `),
  diag('cs0534-abstract-not-implemented',cs`
    using System;
    Console.WriteLine(1);
    abstract class A { public abstract void F(); }
    class B : A { }
  `),
  diag('cs0506-override-non-virtual',cs`
    using System;
    Console.WriteLine(1);
    class A { public void F() { } }
    class B : A { public override void F() { } }
  `),
  diag('cs0108-hides-inherited',cs`
    using System;
    Console.WriteLine(1);
    class A { public void F() { } }
    class B : A { public void F() { } }
  `),
  diag('cs0114-hides-virtual',cs`
    using System;
    Console.WriteLine(1);
    class A { public virtual void F() { } }
    class B : A { public void F() { } }
  `),
  diag('cs0509-derive-from-sealed',cs`
    using System;
    Console.WriteLine(1);
    sealed class A { }
    class B : A { }
  `),
  diag('cs0146-circular-base',cs`
    using System;
    Console.WriteLine(1);
    class A : B { }
    class B : A { }
  `),
  diag('cs0266-base-to-derived',cs`
    using System;
    A a = new B();
    B b = a;
    Console.WriteLine(b);
    class A { }
    class B : A { }
  `),
  diag('cs7036-base-constructor',cs`
    using System;
    Console.WriteLine(1);
    class A { public A(int x) { } }
    class B : A { public B() { } }
  `),
]),
...feature('interfaces',[
  out('implement-and-dispatch',cs`
    using System;
    IShape[] shapes = { new Sq(2), new Rc(2, 3) };
    int total = 0;
    foreach (IShape s in shapes) { Console.WriteLine(s.Name); total += s.Area(); }
    Console.WriteLine(total);
    interface IShape { string Name { get; } int Area(); }
    class Sq : IShape
    {
        int s; public Sq(int s) { this.s = s; }
        public string Name => "sq";
        public int Area() => s * s;
    }
    class Rc : IShape
    {
        int w, h; public Rc(int w, int h) { this.w = w; this.h = h; }
        public string Name => "rc";
        public int Area() => w * h;
    }
  `),
  out('multiple-and-explicit',cs`
    using System;
    var d = new Duck();
    Console.WriteLine(d.Walk());
    Console.WriteLine(((ISwimmer)d).Move());
    Console.WriteLine(((IWalker)d).Move());
    Console.WriteLine(d is ISwimmer);
    interface IWalker { string Move(); }
    interface ISwimmer { string Move(); }
    class Duck : IWalker, ISwimmer
    {
        public string Walk() { return "waddle"; }
        string IWalker.Move() { return "walk"; }
        string ISwimmer.Move() { return "swim"; }
    }
  `),
  out('icomparable-sort',cs`
    using System;
    using System.Collections.Generic;
    var list = new List<Version2> { new Version2(2, 1), new Version2(1, 9), new Version2(2, 0) };
    list.Sort();
    foreach (var v in list) Console.WriteLine(v);
    class Version2 : IComparable<Version2>
    {
        int major, minor;
        public Version2(int major, int minor) { this.major = major; this.minor = minor; }
        public int CompareTo(Version2 other) { return major != other.major ? major - other.major : minor - other.minor; }
        public override string ToString() { return major + "." + minor; }
    }
  `),
  diag('cs0535-not-implemented',cs`
    using System;
    Console.WriteLine(1);
    interface I { void F(); int G(); }
    class C : I { public void F() { } }
  `),
  diag('cs0144-instantiate-interface',cs`
    using System;
    var i = new I();
    Console.WriteLine(i);
    interface I { }
  `),
  diag('cs0738-wrong-return-type',cs`
    using System;
    Console.WriteLine(1);
    interface I { int F(); }
    class C : I { public string F() { return ""; } }
  `),
]),
...feature('structs',[
  out('value-semantics',cs`
    using System;
    var a = new Vec(1, 2);
    var b = a;
    b.X = 10;
    Console.WriteLine(a.X + " " + b.X);
    Vec zero = default(Vec);
    Console.WriteLine(zero.X + zero.Y);
    Console.WriteLine(a.Add(b).X);
    struct Vec
    {
        public int X, Y;
        public Vec(int x, int y) { X = x; Y = y; }
        public Vec Add(Vec o) { return new Vec(X + o.X, Y + o.Y); }
    }
  `),
  out('struct-in-array',cs`
    using System;
    var ps = new P[3];
    ps[1].V = 5;
    for (int i = 0; i < ps.Length; i++) Console.Write(ps[i].V + " ");
    Console.WriteLine();
    struct P { public int V; }
  `),
  out('operator-overloads',cs`
    using System;
    var a = new V(1, 2); var b = new V(3, 4);
    V c = a + b;
    Console.WriteLine(c.X + "," + c.Y);
    Console.WriteLine(a == new V(1, 2));
    Console.WriteLine(a != b);
    struct V
    {
        public int X, Y;
        public V(int x, int y) { X = x; Y = y; }
        public static V operator +(V l, V r) { return new V(l.X + r.X, l.Y + r.Y); }
        public static bool operator ==(V l, V r) { return l.X == r.X && l.Y == r.Y; }
        public static bool operator !=(V l, V r) { return !(l == r); }
        public override bool Equals(object o) { return o is V v && this == v; }
        public override int GetHashCode() { return X ^ Y; }
    }
  `),
  diag('cs0037-null-to-struct',cs`
    using System;
    P p = null;
    Console.WriteLine(p.V);
    struct P { public int V; }
  `),
  diag('cs0170-unassigned-field',cs`
    using System;
    class C
    {
        static void Main() { P p; Console.WriteLine(p.V); }
    }
    struct P { public int V; }
  `),
]),
...feature('enums',[
  out('values-and-names',cs`
    using System;
    Color c = Color.Green;
    Console.WriteLine(c);
    Console.WriteLine((int)c);
    Console.WriteLine((Color)2);
    Console.WriteLine(c == Color.Green);
    Console.WriteLine(Color.Blue > c);
    Console.WriteLine(c.ToString().Length);
    enum Color { Red, Green, Blue }
  `),
  out('explicit-values-and-switch',cs`
    using System;
    foreach (Level l in new[] { Level.Low, Level.High, (Level)7 })
    {
        switch (l)
        {
            case Level.Low: Console.WriteLine("low " + (int)l); break;
            case Level.High: Console.WriteLine("high " + (int)l); break;
            default: Console.WriteLine("unknown " + l); break;
        }
    }
    enum Level { Low = 10, Mid = 20, High = Mid * 2 }
  `),
  out('flags',cs`
    using System;
    Perm p = Perm.Read | Perm.Write;
    Console.WriteLine(p);
    Console.WriteLine((p & Perm.Write) != 0);
    Console.WriteLine((p & Perm.Exec) != 0);
    Console.WriteLine(p.HasFlag(Perm.Read));
    [Flags] enum Perm { None = 0, Read = 1, Write = 2, Exec = 4 }
  `),
  diag('cs0266-enum-to-int',cs`
    using System;
    int n = Color.Red;
    Console.WriteLine(n);
    enum Color { Red }
  `),
  diag('cs0117-missing-enum-member',cs`
    using System;
    Console.WriteLine(Color.Purple);
    enum Color { Red }
  `),
]),
...feature('generics',[
  out('generic-class',cs`
    using System;
    var a = new Box<int>(5);
    var b = new Box<string>("five");
    Console.WriteLine(a.Value + 1);
    Console.WriteLine(b.Value.Length);
    Console.WriteLine(a.Describe() + " " + b.Describe());
    class Box<T>
    {
        public T Value { get; }
        public Box(T value) { Value = value; }
        public string Describe() { return "Box(" + Value + ")"; }
    }
  `),
  out('generic-method',cs`
    using System;
    T First<T>(T[] items) { return items[0]; }
    void Swap<T>(ref T a, ref T b) { T t = a; a = b; b = t; }
    Console.WriteLine(First(new[] { 3, 2, 1 }));
    Console.WriteLine(First<string>(new[] { "x", "y" }));
    string s = "l", t = "r";
    Swap(ref s, ref t);
    Console.WriteLine(s + t);
  `),
  out('constraint-and-pair',cs`
    using System;
    Console.WriteLine(Max(3, 9));
    Console.WriteLine(Max("pear", "apple"));
    var p = new Pair<string, int>("k", 2);
    Console.WriteLine(p.First + p.Second);
    static T Max<T>(T a, T b) where T : IComparable<T> { return a.CompareTo(b) >= 0 ? a : b; }
    class Pair<A, B>
    {
        public A First; public B Second;
        public Pair(A a, B b) { First = a; Second = b; }
    }
  `),
  diag('cs0305-wrong-arity',cs`
    using System;
    using System.Collections.Generic;
    List<int, int> xs = null;
    Console.WriteLine(xs);
  `),
  diag('cs0411-cannot-infer',cs`
    using System;
    class C
    {
        static T Make<T>() { return default(T); }
        static void Main() { var x = Make(); Console.WriteLine(x); }
    }
  `),
  diag('cs0311-constraint-violated',cs`
    using System;
    class C
    {
        static void Need<T>(T x) where T : IDisposable { }
        static void Main() { Need("text"); Console.WriteLine(1); }
    }
  `),
  diag('cs0308-non-generic-with-type-args',cs`
    using System;
    class C
    {
        static void F() { }
        static void Main() { F<int>(); Console.WriteLine(1); }
    }
  `),
]),
...feature('accessibility',[
  out('protected-and-private-within',cs`
    using System;
    Console.WriteLine(new D().Read());
    class B
    {
        private int secret = 4;
        protected int Shared() { return secret * 10; }
    }
    class D : B
    {
        public int Read() { return Shared() + 2; }
    }
  `),
  diag('cs0122-private-field',cs`
    using System;
    var c = new C();
    Console.WriteLine(c.secret);
    class C { private int secret = 1; }
  `),
  diag('cs0122-default-private-method',cs`
    using System;
    var c = new C();
    c.Hidden();
    class C { void Hidden() { } }
  `),
  diag('cs0122-protected-from-outside',cs`
    using System;
    var c = new C();
    Console.WriteLine(c.Value);
    class C { protected int Value = 1; }
  `),
  diag('cs0122-private-constructor',cs`
    using System;
    var c = new C();
    Console.WriteLine(c);
    class C { private C() { } }
  `),
  diag('cs0122-private-nested-type',cs`
    using System;
    var i = new Outer.Inner();
    Console.WriteLine(i);
    class Outer { class Inner { } }
  `),
  diag('cs0050-inconsistent-accessibility',cs`
    using System;
    Console.WriteLine(1);
    class Hidden { }
    public class Api { public Hidden Get() { return null; } }
  `),
]),
...feature('declarations',[
  diag('cs0101-duplicate-type',cs`
    using System;
    Console.WriteLine(1);
    class A { }
    class A { }
  `),
  diag('cs0102-duplicate-field',cs`
    using System;
    Console.WriteLine(1);
    class A { int x; string x; }
  `),
  diag('cs0102-field-and-property',cs`
    using System;
    Console.WriteLine(1);
    class A { public int Value; public int Value { get; set; } }
  `),
  diag('cs0111-duplicate-method',cs`
    using System;
    Console.WriteLine(1);
    class A { void F(int a) { } void F(int b) { } }
  `),
  diag('cs0111-return-type-only',cs`
    using System;
    Console.WriteLine(1);
    class A { int F() { return 1; } string F() { return ""; } }
  `),
  diag('cs0111-duplicate-constructor',cs`
    using System;
    Console.WriteLine(1);
    class A { public A(int a) { } public A(int b) { } }
  `),
  diag('cs0100-duplicate-parameter',cs`
    using System;
    Console.WriteLine(1);
    class A { void F(int a, string a) { } }
  `),
  diag('cs0128-duplicate-local',cs`
    using System;
    int x = 1;
    int x = 2;
    Console.WriteLine(x);
  `),
  diag('cs0128-different-types',cs`
    using System;
    class C
    {
        static void Main() { int x = 1; string x = "a"; Console.WriteLine(x); }
    }
  `),
  diag('cs0136-nested-scope',cs`
    using System;
    class C
    {
        static void Main()
        {
            { int x = 1; Console.WriteLine(x); }
            if (true) { int y = 2; { int y = 3; Console.WriteLine(y); } }
        }
    }
  `),
  diag('cs0136-parameter-shadowed',cs`
    using System;
    class C
    {
        static void F(int a) { int a = 2; Console.WriteLine(a); }
        static void Main() { F(1); }
    }
  `),
  diag('cs0136-declared-later-in-outer',cs`
    using System;
    class C
    {
        static void Main()
        {
            { int x = 1; Console.WriteLine(x); }
            int x = 2;
            Console.WriteLine(x);
        }
    }
  `),
  diag('cs0542-member-named-as-type',cs`
    using System;
    Console.WriteLine(1);
    class A { int A; }
  `),
  diag('cs0841-use-before-declaration',cs`
    using System;
    Console.WriteLine(x);
    int x = 1;
  `),
  diag('cs0815-var-null',cs`
    using System;
    var x = null;
    Console.WriteLine(x);
  `),
  diag('cs0818-var-without-initializer',cs`
    using System;
    var x;
    Console.WriteLine(1);
  `),
  diag('cs0017-multiple-entry-points',cs`
    using System;
    class A { static void Main() { Console.WriteLine(1); } }
    class B { static void Main() { Console.WriteLine(2); } }
  `),
  diag('cs5001-no-entry-point',cs`
    using System;
    class A { void F() { Console.WriteLine(1); } }
  `),
]),
...feature('name-lookup',[
  out('shadowing-field-with-local',cs`
    using System;
    new C().Run(5);
    class C
    {
        int value = 1;
        public void Run(int value)
        {
            Console.WriteLine(value);
            Console.WriteLine(this.value);
            this.value = value;
            Console.WriteLine(this.value);
        }
    }
  `),
  diag('cs0103-unknown-name',cs`
    using System;
    Console.WriteLine(y);
  `),
  diag('cs0103-unknown-method',cs`
    using System;
    Missing(1);
    Console.WriteLine(1);
  `),
  diag('cs0103-typo-in-assignment',cs`
    using System;
    int count = 0;
    cuont = 1;
    Console.WriteLine(count);
  `),
  diag('cs0246-unknown-type',cs`
    using System;
    Widget w = null;
    Console.WriteLine(w);
  `),
  diag('cs0246-unknown-type-in-new',cs`
    using System;
    var w = new Widget();
    Console.WriteLine(w);
  `),
  diag('cs0246-unknown-type-in-signature',cs`
    using System;
    class C
    {
        static Widget Make(Gadget g) { return null; }
        static void Main() { Console.WriteLine(1); }
    }
  `),
  diag('cs0246-unknown-base-type',cs`
    using System;
    Console.WriteLine(1);
    class C : Missing { }
  `),
  diag('cs0119-type-used-as-variable',cs`
    using System;
    class C
    {
        static void Main() { Console.WriteLine(C + 1); }
    }
  `),
  diag('cs0103-console-without-using',cs`
    Console.WriteLine(1);
  `),
]),
...feature('member-access',[
  diag('cs1061-unknown-instance-member',cs`
    using System;
    var c = new C();
    Console.WriteLine(c.Missing);
    class C { }
  `),
  diag('cs1061-unknown-method',cs`
    using System;
    var c = new C();
    c.Go(1);
    class C { }
  `),
  diag('cs1061-on-int',cs`
    using System;
    int n = 5;
    Console.WriteLine(n.Length);
  `),
  diag('cs1061-on-list',cs`
    using System;
    using System.Collections.Generic;
    var xs = new List<int>();
    Console.WriteLine(xs.Length);
  `),
  diag('cs0117-unknown-static-member',cs`
    using System;
    Console.WriteLine(C.Missing);
    class C { }
  `),
  diag('cs0117-console-typo',cs`
    using System;
    Console.WriteLin("x");
  `),
  diag('cs0117-math-typo',cs`
    using System;
    Console.WriteLine(Math.Squareroot(4));
  `),
  diag('cs0117-object-initializer',cs`
    using System;
    var c = new C { Missing = 1 };
    Console.WriteLine(c);
    class C { }
  `),
  diag('cs1955-invoke-non-method',cs`
    using System;
    var c = new C();
    Console.WriteLine(c.Value());
    class C { public int Value = 1; }
  `),
  diag('cs0428-method-group-to-int',cs`
    using System;
    var c = new C();
    int n = c.Get;
    Console.WriteLine(n);
    class C { public int Get() { return 1; } }
  `),
  diag('cs0021-index-non-indexable',cs`
    using System;
    int n = 5;
    Console.WriteLine(n[0]);
  `),
  diag('cs0149-call-non-method-local',cs`
    using System;
    int n = 5;
    Console.WriteLine(n());
  `),
]),
...feature('namespaces',[
  out('nested-and-qualified',cs`
    using System;
    namespace App.Models
    {
        class Item { public string Name = "item"; }
    }
    namespace App
    {
        using App.Models;
        class Program
        {
            static void Main()
            {
                Console.WriteLine(new Item().Name);
                Console.WriteLine(new App.Models.Item().Name.Length);
                System.Console.WriteLine(global::System.Math.Max(1, 2));
            }
        }
    }
  `),
  out('using-alias-and-static',cs`
    using System;
    using static System.Math;
    using Text = System.Text.StringBuilder;
    using Ints = System.Collections.Generic.List<int>;
    var t = new Text();
    t.Append("abs=").Append(Abs(-3));
    Console.WriteLine(t.ToString());
    var xs = new Ints { 1, 2 };
    Console.WriteLine(xs.Count + Max(4, 5));
  `),
  out('file-scoped',cs`
    using System;
    namespace Demo;
    class Program
    {
        static void Main() { Console.WriteLine(typeof(Program).FullName); Console.WriteLine(new Helper().Id()); }
    }
    class Helper { public int Id() { return 3; } }
  `),
  out('same-name-different-namespaces',cs`
    using System;
    namespace A { class Thing { public string Who() { return "A"; } } }
    namespace B { class Thing { public string Who() { return "B"; } } }
    namespace Main
    {
        class Program
        {
            static void Main() { Console.WriteLine(new A.Thing().Who() + new B.Thing().Who()); }
        }
    }
  `),
  diag('cs0104-ambiguous-reference',cs`
    using System;
    using A;
    using B;
    namespace A { class Thing { } }
    namespace B { class Thing { } }
    class Program
    {
        static void Main() { Thing t = null; Console.WriteLine(t); }
    }
  `),
  diag('cs0104-framework-ambiguity',cs`
    using System;
    using System.Threading;
    using System.Timers;
    class Program
    {
        static void Main() { Timer t = null; Console.WriteLine(t); }
    }
  `),
  diag('cs0234-missing-namespace-member',cs`
    using System;
    class Program
    {
        static void Main() { System.Missing.Thing t = null; Console.WriteLine(t); }
    }
  `),
  diag('cs0246-unknown-using',cs`
    using System;
    using Does.Not.Exist;
    Console.WriteLine(1);
  `),
  diag('cs0246-list-without-using',cs`
    using System;
    var xs = new List<int>();
    Console.WriteLine(xs.Count);
  `),
  diag('cs0101-duplicate-in-namespace',cs`
    using System;
    namespace N { class A { } }
    namespace N { class A { } }
    class Program { static void Main() { Console.WriteLine(1); } }
  `),
  diag('cs0105-duplicate-using',cs`
    using System;
    using System;
    Console.WriteLine(1);
  `),
  diag('cs1529-using-after-declaration',cs`
    using System;
    namespace N { class A { } }
    using System.Text;
    class Program { static void Main() { Console.WriteLine(1); } }
  `),
]),
];
