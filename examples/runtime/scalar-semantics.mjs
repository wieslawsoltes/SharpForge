// node examples/runtime/scalar-semantics.mjs
import {runExampleIfMain} from './example-routes.mjs';

export const source = `using System;
class Program {
  static void Main() {
    long wide = int.MaxValue; wide++; Console.WriteLine(wide);
    uint wrapped = uint.MaxValue; wrapped++; Console.WriteLine(wrapped);
    float rounded = 16777216f; rounded += 1f; Console.WriteLine(rounded - 16777216f);
    decimal left = 0.1m; decimal right = 0.2m; Console.WriteLine(left + right);
    Console.WriteLine(BitConverter.DoubleToInt64Bits(-0.0));
    float zero = 0f; Console.WriteLine(zero / zero);
    int maximum = int.MaxValue;
    try { checked { maximum++; } }
    catch (OverflowException) { Console.WriteLine("overflow"); }
    int divisor = 0;
    try { Console.WriteLine(1 / divisor); }
    catch (DivideByZeroException) { Console.WriteLine("divide"); }
  }
}`;

export const expected = '2147483648\n0\n0\n0.3\n-9223372036854775808\nNaN\noverflow\ndivide\n';
runExampleIfMain(import.meta.url, source, expected);
