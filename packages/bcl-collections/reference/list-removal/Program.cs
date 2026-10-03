using System;
using System.Collections.Generic;

var values = new List<int>(new int[] {0, 1, 2, 3, 4});
values.Capacity = 8;
var copy = values.ToArray();
values.RemoveAt(4); values.RemoveRange(1, 2); values.RemoveRange(values.Count, 0);
Console.WriteLine(string.Join(",", values.ToArray()));
Console.WriteLine(string.Join(",", copy));
Console.WriteLine(values.Count); Console.WriteLine(values.Capacity);
values.RemoveAt(0); values.RemoveRange(0, 1); values.RemoveRange(0, 0);
Console.WriteLine(values.Count); Console.WriteLine(values.Capacity);
var empty = new List<int>();
empty.RemoveRange(0, 0);
Console.WriteLine(empty.Count); Console.WriteLine(empty.Capacity);
values.Add(7); values.Add(8); values.Add(9);
values.RemoveRange(0, 1);
GC.Collect();
Console.WriteLine(string.Join(",", values.ToArray()));
