/**
 * Default interface members and static abstract members (SF-A02-T03.6): the most specific implementation of an
 * interface member among the interfaces of a type (CS8705 when there is none), and the static abstract / virtual
 * operators and members of an interface reached through a type parameter (generic math).
 */
import { cs, out, diag, feature } from './kit.js';

const mostSpecific = [
  diag(
    'cs8705-diamond',
    cs`
    interface A { void M() { } int P { get { return 0; } } }
    interface B : A { void A.M() { } int A.P { get { return 1; } } }
    interface C : A { void A.M() { } int A.P { get { return 2; } } }
    class D : B, C { }
    struct S : B, C { }
    class Program { static void Main() { } }
    `,
  ),
  diag(
    'cs8705-abstract-member-two-defaults',
    cs`
    interface A { void M(); }
    interface B : A { void A.M() { } }
    interface C : A { void A.M() { } }
    class D : B, C { }
    class Fine : B, C { public void M() { } }
    class Explicit : B, C { void A.M() { } }
    class Program { static void Main() { } }
    `,
  ),
  diag(
    'most-specific-wins-and-reabstraction',
    cs`
    interface A { void M() { } }
    interface B : A { void A.M() { } }
    interface C : A { void A.M() { } }
    interface E : B, C { void A.M() { } }
    class Joined : E { }
    class Linear : B { }
    interface R : A { abstract void A.M(); }
    class Reabstracted : R { }
    class ReabstractedButImplemented : R { public void M() { } }
    interface Q : A { void N(); }
    class Inherits : Q { public void N() { } }
    class Program { static void Main() { } }
    `,
  ),
  diag(
    'derived-interface-implements-abstract-member',
    cs`
    interface A { void M(); int P { get; } }
    interface B : A { void A.M() { } }
    class OnlyM : B { }
    class Both : B { public int P { get { return 1; } } }
    class Base : B { public int P { get { return 1; } } }
    class Derived : Base, C { }
    interface C : A { void A.M() { } }
    class Program { static void Main() { } }
    `,
  ),
];

const staticOperators = [
  out(
    'generic-math',
    cs`
    using System;
    interface IAdd<T> where T : IAdd<T> {
      static abstract T operator +(T a, T b);
      static abstract T operator -(T a);
      static abstract bool operator ==(T a, T b);
      static abstract bool operator !=(T a, T b);
      static abstract T Zero { get; }
      static abstract T Parse(string text);
      static virtual string Describe() { return "number"; }
    }
    class Num : IAdd<Num> {
      public int V;
      public Num(int v) { V = v; }
      public static Num operator +(Num a, Num b) { return new Num(a.V + b.V); }
      public static Num operator -(Num a) { return new Num(-a.V); }
      public static bool operator ==(Num a, Num b) { return a.V == b.V; }
      public static bool operator !=(Num a, Num b) { return a.V != b.V; }
      public static Num Zero { get { return new Num(0); } }
      public static Num Parse(string text) { return new Num(text.Length); }
    }
    class Text : IAdd<Text> {
      public string S;
      public Text(string s) { S = s; }
      public static Text operator +(Text a, Text b) { return new Text(a.S + b.S); }
      public static Text operator -(Text a) { return new Text("-" + a.S); }
      public static bool operator ==(Text a, Text b) { return a.S == b.S; }
      public static bool operator !=(Text a, Text b) { return a.S != b.S; }
      public static Text Zero { get { return new Text(""); } }
      public static Text Parse(string text) { return new Text(text); }
      public static string Describe() { return "text"; }
    }
    class Program {
      static T Sum<T>(T a, T b) where T : IAdd<T> { return T.Zero + a + b; }
      static T SumAll<T>(T[] items) where T : IAdd<T> {
        T total = T.Zero;
        foreach (T item in items) total += item;
        return total;
      }
      static bool Same<T>(T a, T b) where T : IAdd<T> { return a == b && !(a != b); }
      static T Negated<T>(string text) where T : IAdd<T> { return -T.Parse(text); }
      static void Main() {
        Console.WriteLine(Sum(new Num(2), new Num(3)).V);
        Console.WriteLine(Sum(new Text("a"), new Text("b")).S);
        Console.WriteLine(SumAll(new Num[] { new Num(1), new Num(2), new Num(4) }).V);
        Console.WriteLine(Same(new Num(1), new Num(1)));
        Console.WriteLine(Same(new Text("x"), new Text("y")));
        Console.WriteLine(Negated<Num>("four").V);
        Console.WriteLine(Negated<Text>("four").S);
      }
    }
    `,
  ),
  out(
    'operators-increment-comparison-and-shadowing',
    cs`
    using System;
    interface IStep<T> where T : IStep<T> {
      static abstract T operator ++(T a);
      static abstract bool operator <(T a, T b);
      static abstract bool operator >(T a, T b);
      static abstract T operator *(T a, int times);
    }
    interface ICounter<T> : IStep<T> where T : ICounter<T> {
      static abstract T Start { get; }
    }
    class Counter : ICounter<Counter> {
      public int N;
      public static Counter operator ++(Counter a) { return new Counter { N = a.N + 1 }; }
      public static bool operator <(Counter a, Counter b) { return a.N < b.N; }
      public static bool operator >(Counter a, Counter b) { return a.N > b.N; }
      public static Counter operator *(Counter a, int times) { return new Counter { N = a.N * times }; }
      public static Counter Start { get { return new Counter { N = 1 }; } }
    }
    class Program {
      static int Steps<T>(T limit) where T : ICounter<T> {
        int steps = 0;
        for (T at = T.Start; at < limit; at++) steps++;
        return steps;
      }
      static T Scale<T>(T value) where T : IStep<T> { T next = value; ++next; return next * 10; }
      static void Main() {
        Console.WriteLine(Steps(new Counter { N = 5 }));
        Console.WriteLine(Scale(new Counter { N = 2 }).N);
      }
    }
    `,
  ),
  diag(
    'operator-errors',
    cs`
    interface IAdd<T> where T : IAdd<T> {
      static abstract T operator +(T a, T b);
      static abstract T Zero { get; }
      static virtual T Twice(T a) { return a + a; }
    }
    interface IPlain<T> { T Value { get; } }
    class Program {
      static T Subtract<T>(T a, T b) where T : IAdd<T> { return a - b; }
      static T Plain<T>(T a, T b) where T : IPlain<T> { return a + b; }
      static T Free<T>(T a, T b) { return a + b; }
      static T Mixed<T>(T a) where T : IAdd<T> { return a + 1; }
      static int Wrong<T>(T a) where T : IAdd<T> { return a + a; }
      static void NotOnInterface<T>(T a) where T : IAdd<T> {
        var zero = IAdd<T>.Zero;
        var twice = IAdd<T>.Twice(a);
      }
      static void Main() { }
    }
    `,
  ),
  diag(
    'operator-implementations',
    cs`
    interface IAdd<T> where T : IAdd<T> {
      static abstract T operator +(T a, T b);
      static abstract T operator -(T a);
    }
    class Missing : IAdd<Missing> { }
    class OnlyPlus : IAdd<OnlyPlus> {
      public static OnlyPlus operator +(OnlyPlus a, OnlyPlus b) { return a; }
    }
    class WrongReturn : IAdd<WrongReturn> {
      public static int operator +(WrongReturn a, WrongReturn b) { return 0; }
      public static WrongReturn operator -(WrongReturn a) { return a; }
    }
    class Complete : IAdd<Complete> {
      public static Complete operator +(Complete a, Complete b) { return a; }
      public static Complete operator -(Complete a) { return a; }
    }
    class Program { static void Main() { } }
    `,
  ),
  diag(
    'operators-of-base-interfaces',
    cs`
    interface IBase<T> where T : IBase<T> {
      static abstract T operator +(T a, T b);
      static abstract T operator -(T a, T b);
      static abstract T operator *(T a, long b);
    }
    interface IDerived<T> : IBase<T> where T : IDerived<T> {
      static abstract T operator +(T a, int b);
      static abstract T operator *(T a, int b);
    }
    class Program {
      static T Own<T>(T a) where T : IDerived<T> { return a + 1; }
      static T Inherited<T>(T a) where T : IDerived<T> { return a - a; }
      static T NotApplicableInDerived<T>(T a) where T : IDerived<T> { return a + a; }
      static T BothApplicable<T>(T a) where T : IDerived<T> { return a * 2; }
      static T OnlyBaseApplicable<T>(T a) where T : IDerived<T> { return a * 2L; }
      static T Missing<T>(T a) where T : IDerived<T> { return a / a; }
      static void Main() { }
    }
    `,
  ),
  diag(
    'static-abstract-operators-in-10',
    cs`
    interface IAdd<T> where T : IAdd<T> {
      static abstract T operator +(T a, T b);
    }
    class Program {
      static T Sum<T>(T a, T b) where T : IAdd<T> { return a + b; }
      static void Main() { }
    }
    `,
    { langVersion: '10' },
  ),
];

export const fixtures = [...feature('interface-most-specific', mostSpecific), ...feature('static-abstract-operators', staticOperators)];
