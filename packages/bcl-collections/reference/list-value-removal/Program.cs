using System;
using System.Collections.Generic;

var values = new List<string>(new string[] {"a", null, "b", "a", null});
values.Capacity = 12;
Console.WriteLine(values.Remove("a"));
Console.WriteLine(string.Join("|", values.ToArray()));
Console.WriteLine(values.Remove(null));
Console.WriteLine(string.Join("|", values.ToArray()));
Console.WriteLine(values.Remove("missing"));
var copy = values.ToArray();
values.Clear(); values.Clear();
Console.WriteLine(values.Count); Console.WriteLine(values.Capacity);
Console.WriteLine(string.Join("|", copy));
values.Add("reused"); GC.Collect();
Console.WriteLine(values[0]); Console.WriteLine(values.Capacity);

var objects = new List<object>();
objects.Add(1); objects.Add(1.0); objects.Add(true); objects.Add("1"); objects.Add(null);
Console.WriteLine(objects.Remove(1)); Console.WriteLine(objects.Contains(1.0));
Console.WriteLine(objects.Remove(1)); Console.WriteLine(objects.Count);
Console.WriteLine(objects.Remove(1.0)); Console.WriteLine(objects.Count);
objects.Clear(); Console.WriteLine(objects.Count);
Console.WriteLine(objects.Remove(null));
