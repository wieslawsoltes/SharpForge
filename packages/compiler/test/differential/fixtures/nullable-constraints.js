/**
 * Differential fixtures for the nullability of type arguments against constraints (SF-A02-T05.6): CS8714 (`notnull`),
 * CS8634 (`class`) and CS8631 (a non-nullable constraint type), on constructed types wherever they are written and on
 * generic method calls with written or inferred type arguments; and for the nullability of overrides and interface
 * implementations (CS8764-CS8769 at the top level of a type, CS8609-CS8617 below it, accessor by accessor).
 */
import { cs, diag, feature } from './kit.js';

const constrained = `
  interface I<T> where T : notnull { }
  interface IShape { }
  class Shape : IShape { }
  class G<T> where T : class { }
  class H<T> where T : Shape { }
  class K<T> where T : IShape { }
  class N<T> where T : class? { }
  class Pair<TKey, TValue> where TKey : notnull where TValue : class { }`;

export const fixtures = feature('nullable-constraints', [
  diag(
    'constructed-types-in-declarations',
    cs`
      #nullable enable
      using System;
      ${constrained}
      class D : I<string?> { }
      class E : I<string> { }
      class F : G<string?> { }
      class F2<U> : G<U> where U : class? { }
      class F3<U> : I<U> { }
      class F4<U> : I<U> where U : notnull { }
      class Generic<U, V> : G<U>, I<V> where U : class? { }
      class Generic2<U> where U : G<string?> { }
      delegate G<string?> Del(G<string?> x);
      class Uses
      {
          I<int?>? a;
          G<string?> b = new G<string?>();
          H<Shape?>? c;
          K<Shape?>? k;
          N<string?>? n;
          Pair<string?, string?>? pair;
          I<string?> Prop { get; set; } = null!;
          G<string?> Method(G<string?> p, out I<string?> q) { q = null!; return p; }
          G<string?>[] array = new G<string?>[1];
          (G<string?>, int) tuple;
          event Action<G<string?>>? Changed;
          G<string?> this[G<string?> i] => i;
          void Raise() { Changed?.Invoke(b); a = null; c = null; k = null; n = null; pair = null; tuple = (b, tuple.Item2); }
      }
      static class P { static void Main() { } }
    `,
  ),
  diag(
    'constructed-types-in-bodies',
    cs`
      #nullable enable
      using System;
      ${constrained}
      static class P
      {
          static void Local()
          {
              G<string?> local;
              void Inner(G<string?> x) { }
              Func<G<string?>, int> f = (G<string?> y) => 1;
              object o = typeof(G<string?>);
              var z = (G<string?>)o;
              bool t = o is G<string?>;
              var d = default(G<string?>);
              var ok = new G<string>();
              var nullable = new N<string?>();
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'method-type-arguments',
    cs`
      #nullable enable
      ${constrained}
      static class P
      {
          static void M<T>(T t) where T : notnull { }
          static void C<T>(T t) where T : class { }
          static T R<T>(T t) where T : Shape => t;
          static void Q<T>(T t) where T : IShape { }
          static void Use(string? maybe, string sure, Shape? shape, Shape solid, IShape? ishape)
          {
              M(maybe);
              M(sure);
              M<string?>(maybe);
              M<int?>(1);
              M(1);
              C(maybe);
              C(sure);
              C<string?>(null);
              R(shape);
              R(solid);
              Q(ishape);
              Q<Shape?>(shape);
              if (maybe != null) { M(maybe); C(maybe); }
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'oblivious-constraints-and-disabled-context',
    cs`
      interface I<T> where T : notnull { }
      class G<T> where T : class { }
      class Shape { }
      class H<T> where T : Shape { }
      class D : I<int?> { }
      #nullable enable
      class Uses
      {
          I<int?>? a;
          G<string?> b = new G<string?>();
          H<Shape?>? c;
          I<string?> Prop { get; set; } = null!;
          void Touch() { a = null; c = null; }
      }
      #nullable disable
      class Off
      {
          I<int?> a;
          static void M<T>(T t) where T : notnull { }
          void Use() { M<int?>(1); var g = new G<string>(); a = null; }
      }
      static class P { static void Main() { } }
    `,
  ),
  diag(
    'signatures-of-methods',
    cs`
      #nullable enable
      class Box<T> { }
      interface IThing
      {
          string Name(string? key);
          string? Maybe(string key);
          void Fill(out string? value);
          Box<string> Items(Box<string?> keys);
          void Take(Box<string> keys, string? key);
      }
      class Thing : IThing
      {
          public string? Name(string key) => key;
          public string Maybe(string? key) => "";
          public void Fill(out string value) { value = ""; }
          public Box<string?> Items(Box<string> keys) => new Box<string?>();
          public void Take(Box<string?> keys, string key) { }
      }
      class Explicit : IThing
      {
          string? IThing.Name(string key) => key;
          string IThing.Maybe(string? key) => "";
          void IThing.Fill(out string value) { value = ""; }
          Box<string?> IThing.Items(Box<string> keys) => new Box<string?>();
          void IThing.Take(Box<string?> keys, string key) { }
      }
      abstract class Base
      {
          public abstract string Name(string? key);
          public abstract string? Maybe(string key);
          public virtual void Fill(out string? value) { value = null; }
          public virtual Box<string> Items(Box<string?> keys) => new Box<string>();
          public virtual void Take(Box<string> keys, string? key) { }
      }
      class Derived : Base
      {
          public override string? Name(string key) => key;
          public override string Maybe(string? key) => "";
          public override void Fill(out string value) { value = ""; }
          public override Box<string?> Items(Box<string> keys) => new Box<string?>();
          public override void Take(Box<string?> keys, string key) { }
      }
      static class P { static void Main() { } }
    `,
  ),
  diag(
    'signatures-of-properties-and-events',
    cs`
      #nullable enable
      using System;
      class Box<T> { }
      interface IThing
      {
          Box<string> Items { get; set; }
          string? Read { get; }
          string Strict { get; }
          string? Prop { get; set; }
          string Sure { get; set; }
          string this[string? key] { get; set; }
          event Action<string>? Changed;
      }
      class Thing : IThing
      {
          public Box<string?> Items { get; set; } = new Box<string?>();
          public string Read => "";
          public string? Strict => null;
          public string Prop { get; set; } = "";
          public string? Sure { get; set; }
          public string this[string key] { get => key; set { } }
          public event Action<string?>? Changed;
          void Raise() => Changed?.Invoke(null);
      }
      class Explicit : IThing
      {
          Box<string?> IThing.Items { get; set; } = new Box<string?>();
          string IThing.Read => "";
          string? IThing.Strict => null;
          string IThing.Prop { get; set; } = "";
          string? IThing.Sure { get; set; }
          string IThing.this[string key] { get => key; set { } }
          public event Action<string>? Changed;
          void Raise() => Changed?.Invoke("");
      }
      abstract class Base
      {
          public virtual Box<string> Items { get; set; } = new Box<string>();
          public virtual string? Read => null;
          public virtual string Strict => "";
          public virtual string this[string? key] { get => ""; set { } }
          public virtual event Action<string>? Changed;
          public virtual string? Loose { get; set; }
          void Raise() => Changed?.Invoke("");
      }
      class Derived : Base
      {
          public override Box<string?> Items { get; set; } = new Box<string?>();
          public override string Read => "";
          public override string? Strict => null;
          public override string this[string key] { get => key; set { } }
          public override event Action<string?>? Changed;
          public override string Loose { get => ""; set { } }
          void Raise() => Changed?.Invoke(null);
      }
      static class P { static void Main() { } }
    `,
  ),
]);
