using System;
using System.Collections.Generic;
using System.Linq;

var values = new HashSet<string>(new string[] {null, "a", "b", "c", "d", "e", "a"});
Console.WriteLine(values.Count); Console.WriteLine(values.Add(null));
Console.WriteLine(values.Remove("b")); Console.WriteLine(values.Remove("d"));
Console.WriteLine(string.Join("|", values.ToArray()));
values.UnionWith(new string[] {"f", "g", "g"});
Console.WriteLine(string.Join("|", values.ToArray()));
values.ExceptWith(new string[] {"c", "a", "c"});
values.UnionWith(new string[] {"h", "i"});
Console.WriteLine(string.Join("|", values.ToArray()));
values.IntersectWith(new string[] {"g", "e", "i", "i"});
values.Add("j"); values.Add("k");
Console.WriteLine(string.Join("|", values.ToArray()));
Console.WriteLine(values.Contains(null)); Console.WriteLine(values.Remove("missing"));
foreach (var item in values.ToArray()) values.Remove(item);
Console.WriteLine(values.Count);
values.Add("x"); values.Add("y");
Console.WriteLine(string.Join("|", values.ToArray()));
values.Clear(); values.UnionWith(new string[] {"first", "second", "first"});
GC.Collect();
Console.WriteLine(string.Join("|", values.ToArray()));
values.IntersectWith(new string[] {}); values.Add("after-empty-intersection");
Console.WriteLine(string.Join("|", values.ToArray()));

var integers = new HashSet<int>(new int[] {0, -1, 2147483647, -2147483648});
integers.Remove(-1); integers.Add(17);
Console.WriteLine(string.Join(",", integers.ToArray()));
foreach (var item in integers) Console.WriteLine(item);
integers.Clear(); integers.Clear();
Console.WriteLine(integers.Count); Console.WriteLine(integers.Remove(0));

var numbers = new HashSet<double>(new double[] {double.NaN, -0.0, 0.0, double.NaN, 1.0});
Console.WriteLine(numbers.Count); Console.WriteLine(numbers.Remove(double.NaN));
Console.WriteLine(numbers.Contains(0.0)); Console.WriteLine(numbers.Remove(-0.0));
numbers.Add(2.0); Console.WriteLine(string.Join(",", numbers.ToArray()));

var objects = new HashSet<object>();
objects.Add(1); objects.Add(1.0); objects.Add(true); objects.Add("1"); objects.Add(null);
Console.WriteLine(objects.Count); Console.WriteLine(objects.Remove(1));
Console.WriteLine(objects.Add(1.0)); Console.WriteLine(objects.Contains(1));
Console.WriteLine(objects.Contains(1.0)); Console.WriteLine(objects.Count);
objects.Remove(null); objects.Add(false);
Console.WriteLine(objects.Contains(false)); Console.WriteLine(objects.Contains(null));
