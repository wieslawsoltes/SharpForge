// node examples/runtime/rectangular-memory.mjs
import {runExampleIfMain} from './example-routes.mjs';

export const source = `using System;
unsafe class Program {
  static void Main() {
    int[,] matrix = new int[2, 3];
    matrix[1, 2] = 37;
    Console.WriteLine(matrix[1, 2]);
    Console.WriteLine(matrix.Rank); Console.WriteLine(matrix.GetLength(1));
    Array shifted = Array.CreateInstance(typeof(int), new int[] { 2, 3 }, new int[] { -2, 4 });
    shifted.SetValue(71, -1, 6);
    Console.WriteLine((int)shifted.GetValue(-1, 6));
    Console.WriteLine(shifted.GetLowerBound(0)); Console.WriteLine(shifted.GetUpperBound(1));
    Span<int> span = stackalloc int[4];
    span[1] = 53;
    Span<int> slice = span.Slice(1, 2);
    slice[1] = 59;
    ReadOnlySpan<int> view = span;
    Console.WriteLine(view[1] + view[2]);
    int[] values = { 1, 2, 3 };
    fixed (int* pointer = values) { pointer[1] = 7; }
    Console.WriteLine(values[1]);
    try { int missing = matrix[0, 3]; }
    catch (IndexOutOfRangeException) { Console.WriteLine("matrix bounds"); }
    try { int missing = span[4]; }
    catch (IndexOutOfRangeException) { Console.WriteLine("span bounds"); }
  }
}`;

export const expected = '37\n2\n3\n71\n-2\n6\n112\n7\nmatrix bounds\nspan bounds\n';
export const options = {compileOptions: {allowUnsafe: true}};
runExampleIfMain(import.meta.url, source, expected, options);
