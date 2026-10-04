// node examples/runtime/exception-order.mjs
import {runExampleIfMain} from './example-routes.mjs';

export const source = `using System;
class Program {
  static int State;
  static void Fail() {
    try { Console.WriteLine("throw"); throw new InvalidOperationException("original"); }
    finally { State = 1; Console.WriteLine("cleanup"); }
  }
  static bool Inspect() { Console.WriteLine(State); return true; }
  static bool ThrowingFilter() {
    try { Console.WriteLine("filter fault"); throw new ArgumentException("ignored"); }
    finally { Console.WriteLine("filter cleanup"); }
  }
  static void Main() {
    try { Fail(); }
    catch (InvalidOperationException error) when (Inspect()) { Console.WriteLine(error.Message); }
    Console.WriteLine(State);
    try { throw new InvalidOperationException("kept"); }
    catch (InvalidOperationException error) when (ThrowingFilter()) { Console.WriteLine("unreachable"); }
    catch (InvalidOperationException error) { Console.WriteLine(error.Message); }
  }
}`;

export const expected = 'throw\n0\ncleanup\noriginal\n1\nfilter fault\nfilter cleanup\nkept\n';
runExampleIfMain(import.meta.url, source, expected);
