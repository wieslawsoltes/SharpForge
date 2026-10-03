using System;
using System.Collections.Generic;

var values = new List<int>(4);
values.AddRange(new int[] {1, 3});
values.Insert(1, 2); values.Insert(0, 0);
var copy = values.ToArray();
values.Insert(values.Count, 4);
values.AddRange(new int[] {5, 6, 7});
Console.WriteLine(string.Join(",", values.ToArray()));
Console.WriteLine(values.Count); Console.WriteLine(values.Capacity);
Console.WriteLine(string.Join(",", copy));
values.AddRange(new int[] {});
values.AddRange(values.ToArray());
Console.WriteLine(string.Join(",", values.ToArray()));
Console.WriteLine(values.Count); Console.WriteLine(values.Capacity);
values.Clear(); values.AddRange(new int[] {});
Console.WriteLine(values.Count); Console.WriteLine(values.Capacity);

var strings = new List<string>();
strings.AddRange(new string[] {});
Console.WriteLine(strings.Count); Console.WriteLine(strings.Capacity);
strings.Insert(0, null); strings.AddRange(new string[] {"a", "b"});
GC.Collect();
Console.WriteLine(string.Join("|", strings.ToArray()));
Console.WriteLine(strings.Count); Console.WriteLine(strings.Capacity);
