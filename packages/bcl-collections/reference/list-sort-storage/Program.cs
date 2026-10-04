using System;
using System.Collections.Generic;

var empty = new List<int>();
var emptyIterator = empty.GetEnumerator();
empty.Sort();
Console.WriteLine(empty.Count); Console.WriteLine(empty.Capacity);
try { emptyIterator.MoveNext(); }
catch (Exception error) { Console.WriteLine(error.GetType().Name); }

var numbers = new List<int>(16);
numbers.AddRange(new int[] {3, -1, 3, 0, 2});
var numberIterator = numbers.GetEnumerator();
numbers.Sort();
Console.WriteLine(string.Join(",", numbers.ToArray()));
Console.WriteLine(numbers.Count); Console.WriteLine(numbers.Capacity);
try { numberIterator.MoveNext(); }
catch (Exception error) { Console.WriteLine(error.GetType().Name); }
numbers.Sort();
Console.WriteLine(string.Join(",", numbers.ToArray()));

var single = new List<int>(7);
single.Add(42);
var singleIterator = single.GetEnumerator();
single.Sort();
Console.WriteLine(single[0]); Console.WriteLine(single.Capacity);
try { singleIterator.MoveNext(); }
catch (Exception error) { Console.WriteLine(error.GetType().Name); }

// Explicit ordinal calls are qualified through managed-platform dispatch.
Console.WriteLine("ordinal");
var ordinalEmpty = new List<string>();
var ordinalIterator = ordinalEmpty.GetEnumerator();
ordinalEmpty.Sort(StringComparer.Ordinal);
Console.WriteLine(ordinalEmpty.Count); Console.WriteLine(ordinalEmpty.Capacity);
try { ordinalIterator.MoveNext(); }
catch (Exception error) { Console.WriteLine(error.GetType().Name); }

var words = new List<string>(12);
words.AddRange(new string[] {"b", "A", null, "a", "", "A"});
words.Sort(StringComparer.Ordinal);
Console.WriteLine(string.Join("|", words.ToArray()));
Console.WriteLine(words.Count); Console.WriteLine(words.Capacity);
GC.Collect();
Console.WriteLine(words[5]);
