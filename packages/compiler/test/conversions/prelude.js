/**
 * The C# declarations the conversion corpus converts between: enums, an interface and class hierarchy, variant
 * interfaces, structs, types with user-defined conversion operators, delegates and a few members for the
 * expression pairs. Both Roslyn (tools/Program.cs) and SharpForge (tests/compiler-conversion-corpus.test.js) see
 * exactly this text.
 */
export const prelude = `using System;
using System.Collections;
using System.Collections.Generic;

enum Color { Red, Green }
enum Wide : long { A, B }
enum Small : byte { One }
interface IShape { }
interface ISolid : IShape { }
interface IBox<out T> { }
interface ISink<in T> { }
class Animal { }
class Dog : Animal, IShape { }
sealed class Cat : Animal { }
class Puppy : Dog, ISolid { }
class Box<T> : IBox<T> { }
struct Point : IShape { public int X; }
struct Meters
{
    public double Value;
    public static implicit operator double(Meters m) => m.Value;
    public static explicit operator Meters(double d) => new Meters { Value = d };
    public static implicit operator Meters(int i) => new Meters { Value = i };
}
class Money
{
    public static implicit operator Money(decimal d) => new Money();
    public static explicit operator int(Money m) => 0;
    public static explicit operator Money(string s) => new Money();
}
class Celsius { public static implicit operator Fahrenheit(Celsius c) => new Fahrenheit(); }
class Fahrenheit { public static explicit operator Celsius(Fahrenheit f) => new Celsius(); }
delegate int Transformer(int x);
delegate void Handler(string s);
delegate object Producer();
delegate Animal AnimalFactory();
static class Helpers
{
    public static int Parse(string s) => 0;
    public static int Twice(int x) => x * 2;
    public static void Log(string s) { }
    public static Dog MakeDog() => new Dog();
    public static int Number = 1;
    public static long Big = 2;
    public static string Text = "t";
    public static Dog Pet = new Dog();
    public static Point Origin = new Point();
    public static Color Shade = Color.Green;
    public static int? Maybe = null;
    public static double Real = 1.5;
    public static int[] Numbers = new int[1];
    public const int Seven = 7;
    public const long Huge = 5000000000;
    public const byte Tiny = 3;
}
`;

/** The generic class whose method parameters carry the corpus types (type parameters included). */
export const typesClass = 'ConversionTypes';
/** The class whose field initializers carry the corpus expressions. */
export const expressionsClass = 'ConversionExpressions';

/** The source of one corpus compilation: the prelude, one parameter per type and one field per expression. */
export function buildSource(types, expressions) {
  const parameters = types.map((type, index) => `        ${type} p${index}`).join(',\n');
  const fields = expressions.map((expression, index) => `    static object e${index} = ${expression};`).join('\n');
  return `${prelude}
static class ${typesClass}<T, TClass, TStruct, TAnimal>
    where TClass : class
    where TStruct : struct
    where TAnimal : Animal
{
    static void Types(
${parameters}) { }
}
static class ${expressionsClass}
{
${fields}
}
`;
}
