/**
 * Differential fixtures for extension method receivers (SF-A02-T06.6): an extension whose `this` parameter the
 * receiver cannot reach by an identity, reference or boxing conversion is CS1929, on source types and on the
 * predefined types; `ref this` receivers are passed by reference (CS1510 for a value).
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = feature('extension-methods', [
  diag(
    'cs1929-receiver-of-another-type',
    cs`
      static class Extensions
      {
          public static int Twice(this int value) => value * 2;
          public static string Shout(this string text) => text + "!";
      }
      static class Program
      {
          static void Main()
          {
              string s = "a";
              int i = 1;
              s.Twice();
              i.Shout();
              "x".Twice();
              (1, 2).Twice();
          }
      }
    `,
  ),
  diag(
    'cs1929-numeric-conversion-is-not-enough',
    cs`
      static class Extensions
      {
          public static int Twice(this int value) => value * 2;
          public static long Wide(this long value) => value;
      }
      static class Program
      {
          static void Main()
          {
              int i = 1;
              double d = 1.5;
              short h = 2;
              d.Twice();
              i.Wide();
              h.Twice();
          }
      }
    `,
  ),
  diag(
    'cs1929-reference-types',
    cs`
      class Animal { }
      class Dog : Animal { }
      interface IShape { }
      struct Square : IShape { }
      static class Extensions
      {
          public static int Legs(this Dog dog) => 4;
          public static int Area(this IShape shape) => 0;
          public static int Side(this Square square) => 1;
      }
      static class Program
      {
          static void Main()
          {
              object o = new Dog();
              Animal a = new Dog();
              IShape shape = new Square();
              o.Legs();
              a.Legs();
              o.Area();
              shape.Side();
          }
      }
    `,
  ),
  diag(
    'cs1929-best-overload',
    cs`
      static class Extensions
      {
          public static int Over(this string text, int n) => n;
          public static int Over(this string text, string s) => 0;
      }
      static class Program
      {
          static void Main()
          {
              double d = 1.5;
              d.Over(1);
              d.Over("a");
          }
      }
    `,
  ),
  diag(
    'cs1929-user-conversion-is-not-enough',
    cs`
      class Meters
      {
          public static implicit operator Feet(Meters m) => new Feet();
      }
      class Feet { }
      static class Extensions
      {
          public static int Inches(this Feet feet) => 12;
      }
      static class Program
      {
          static void Main()
          {
              var m = new Meters();
              Feet f = m;
              f.Inches();
              m.Inches();
          }
      }
    `,
  ),
  diag(
    'cs1510-ref-this-receiver',
    cs`
      static class Extensions
      {
          public static void Bump(ref this int value) { value++; }
      }
      static class Program
      {
          static void Main()
          {
              int i = 1;
              i.Bump();
              5.Bump();
          }
      }
    `,
  ),
  diag(
    'cs0411-generic-array-receiver',
    cs`
      static class Extensions
      {
          public static int Size<T>(this T[] items) => items.Length;
      }
      static class Program
      {
          static void Main()
          {
              int i = 1;
              i.Size();
          }
      }
    `,
  ),
  out(
    'valid-receiver-conversions',
    cs`
      using System;
      class Animal { }
      class Dog : Animal { }
      interface IShape { }
      struct Square : IShape { }
      static class Extensions
      {
          public static int Twice(this int value) => value * 2;
          public static string Shout(this string text) => text + "!";
          public static int Count(this Animal animal) => 1;
          public static int Size<T>(this T[] items) => items.Length;
          public static int Measure(this IShape shape) => 7;
          public static string Describe(this object value) => "obj";
          public static void Bump(ref this int value) { value++; }
          public static int First(this (int, int) pair) => pair.Item1;
      }
      static class Program
      {
          static void Main()
          {
              int i = 1;
              i.Bump();
              var dog = new Dog();
              Console.WriteLine(dog.Count() + " " + i.Twice() + " " + new int[2].Size() + " " + new Square().Measure());
              Console.WriteLine("a".Shout() + " " + 5.Describe() + " " + "s".Describe() + " " + (3, 4).First());
          }
      }
    `,
  ),
]);
