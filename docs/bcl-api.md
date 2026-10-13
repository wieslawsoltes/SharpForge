# Common BCL contract inventory — 0.13.0

Generated from the actual closed registry. See csharp-designer-winui.md for deviations, bounds and supported generic arguments. These contracts are not full native BCL/CLR generics.

## `System.Text.StringBuilder`

- `System.Text.StringBuilder .ctor()`
- `System.Text.StringBuilder .ctor(int)`
- `System.Text.StringBuilder .ctor(string)`
- `System.Text.StringBuilder .ctor(string, int)`
- `int get_Length()`
- `void set_Length(int)`
- `int get_Capacity()`
- `void set_Capacity(int)`
- `int get_MaxCapacity()`
- `System.Text.StringBuilder Append(int)`
- `System.Text.StringBuilder Append(double)`
- `System.Text.StringBuilder Append(bool)`
- `System.Text.StringBuilder Append(string)`
- `System.Text.StringBuilder Append(object)`
- `System.Text.StringBuilder AppendLine()`
- `System.Text.StringBuilder AppendLine(string)`
- `System.Text.StringBuilder Clear()`
- `string ToString()`
- `string ToString(int, int)`
- `System.Text.StringBuilder Insert(int, string)`
- `System.Text.StringBuilder Remove(int, int)`
- `System.Text.StringBuilder Replace(string, string)`
- `int EnsureCapacity(int)`
- `System.Text.StringBuilder AppendFormat(string, object)`
- `System.Text.StringBuilder AppendFormat(string, object, object)`
- `System.Text.StringBuilder AppendFormat(string, object, object, object)`

## `SharpForge.Runtime.Enumerator`1<int>`

- `bool MoveNext()`
- `int get_Current()`
- `void Dispose()`

## `System.Collections.Generic.List`1<int>`

- `System.Collections.Generic.List`1<int> .ctor()`
- `System.Collections.Generic.List`1<int> .ctor(int)`
- `System.Collections.Generic.List`1<int> .ctor(int[])`
- `int get_Count()`
- `int get_Capacity()`
- `void set_Capacity(int)`
- `void Clear()`
- `bool Contains(int)`
- `int[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<int> GetEnumerator()`
- `void Add(int)`
- `void AddRange(int[])`
- `void Insert(int, int)`
- `bool Remove(int)`
- `void RemoveAt(int)`
- `void RemoveRange(int, int)`
- `int IndexOf(int)`
- `int get_Item(int)`
- `void set_Item(int, int)`
- `void Reverse()`
- `void Sort()`

## `System.Collections.Generic.HashSet`1<int>`

- `System.Collections.Generic.HashSet`1<int> .ctor()`
- `System.Collections.Generic.HashSet`1<int> .ctor(int)`
- `System.Collections.Generic.HashSet`1<int> .ctor(int[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(int)`
- `int[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<int> GetEnumerator()`
- `bool Add(int)`
- `bool Remove(int)`
- `void UnionWith(int[])`
- `void IntersectWith(int[])`
- `void ExceptWith(int[])`

## `System.Collections.Generic.Queue`1<int>`

- `System.Collections.Generic.Queue`1<int> .ctor()`
- `System.Collections.Generic.Queue`1<int> .ctor(int)`
- `System.Collections.Generic.Queue`1<int> .ctor(int[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(int)`
- `int[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<int> GetEnumerator()`
- `void Enqueue(int)`
- `int Dequeue()`
- `int Peek()`

## `System.Collections.Generic.Stack`1<int>`

- `System.Collections.Generic.Stack`1<int> .ctor()`
- `System.Collections.Generic.Stack`1<int> .ctor(int)`
- `System.Collections.Generic.Stack`1<int> .ctor(int[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(int)`
- `int[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<int> GetEnumerator()`
- `void Push(int)`
- `int Pop()`
- `int Peek()`

## `System.Collections.Generic.Dictionary`2<string, int>`

- `System.Collections.Generic.Dictionary`2<string, int> .ctor()`
- `System.Collections.Generic.Dictionary`2<string, int> .ctor(int)`
- `int get_Count()`
- `string[] get_Keys()`
- `int[] get_Values()`
- `void Add(string, int)`
- `bool TryAdd(string, int)`
- `bool ContainsKey(string)`
- `bool ContainsValue(int)`
- `bool Remove(string)`
- `void Clear()`
- `int get_Item(string)`
- `void set_Item(string, int)`

## `System.Collections.Generic.Dictionary`2<int, int>`

- `System.Collections.Generic.Dictionary`2<int, int> .ctor()`
- `System.Collections.Generic.Dictionary`2<int, int> .ctor(int)`
- `int get_Count()`
- `int[] get_Keys()`
- `int[] get_Values()`
- `void Add(int, int)`
- `bool TryAdd(int, int)`
- `bool ContainsKey(int)`
- `bool ContainsValue(int)`
- `bool Remove(int)`
- `void Clear()`
- `int get_Item(int)`
- `void set_Item(int, int)`

## `SharpForge.Runtime.Enumerator`1<double>`

- `bool MoveNext()`
- `double get_Current()`
- `void Dispose()`

## `System.Collections.Generic.List`1<double>`

- `System.Collections.Generic.List`1<double> .ctor()`
- `System.Collections.Generic.List`1<double> .ctor(int)`
- `System.Collections.Generic.List`1<double> .ctor(double[])`
- `int get_Count()`
- `int get_Capacity()`
- `void set_Capacity(int)`
- `void Clear()`
- `bool Contains(double)`
- `double[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<double> GetEnumerator()`
- `void Add(double)`
- `void AddRange(double[])`
- `void Insert(int, double)`
- `bool Remove(double)`
- `void RemoveAt(int)`
- `void RemoveRange(int, int)`
- `int IndexOf(double)`
- `double get_Item(int)`
- `void set_Item(int, double)`
- `void Reverse()`
- `void Sort()`

## `System.Collections.Generic.HashSet`1<double>`

- `System.Collections.Generic.HashSet`1<double> .ctor()`
- `System.Collections.Generic.HashSet`1<double> .ctor(int)`
- `System.Collections.Generic.HashSet`1<double> .ctor(double[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(double)`
- `double[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<double> GetEnumerator()`
- `bool Add(double)`
- `bool Remove(double)`
- `void UnionWith(double[])`
- `void IntersectWith(double[])`
- `void ExceptWith(double[])`

## `System.Collections.Generic.Queue`1<double>`

- `System.Collections.Generic.Queue`1<double> .ctor()`
- `System.Collections.Generic.Queue`1<double> .ctor(int)`
- `System.Collections.Generic.Queue`1<double> .ctor(double[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(double)`
- `double[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<double> GetEnumerator()`
- `void Enqueue(double)`
- `double Dequeue()`
- `double Peek()`

## `System.Collections.Generic.Stack`1<double>`

- `System.Collections.Generic.Stack`1<double> .ctor()`
- `System.Collections.Generic.Stack`1<double> .ctor(int)`
- `System.Collections.Generic.Stack`1<double> .ctor(double[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(double)`
- `double[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<double> GetEnumerator()`
- `void Push(double)`
- `double Pop()`
- `double Peek()`

## `System.Collections.Generic.Dictionary`2<string, double>`

- `System.Collections.Generic.Dictionary`2<string, double> .ctor()`
- `System.Collections.Generic.Dictionary`2<string, double> .ctor(int)`
- `int get_Count()`
- `string[] get_Keys()`
- `double[] get_Values()`
- `void Add(string, double)`
- `bool TryAdd(string, double)`
- `bool ContainsKey(string)`
- `bool ContainsValue(double)`
- `bool Remove(string)`
- `void Clear()`
- `double get_Item(string)`
- `void set_Item(string, double)`

## `System.Collections.Generic.Dictionary`2<int, double>`

- `System.Collections.Generic.Dictionary`2<int, double> .ctor()`
- `System.Collections.Generic.Dictionary`2<int, double> .ctor(int)`
- `int get_Count()`
- `int[] get_Keys()`
- `double[] get_Values()`
- `void Add(int, double)`
- `bool TryAdd(int, double)`
- `bool ContainsKey(int)`
- `bool ContainsValue(double)`
- `bool Remove(int)`
- `void Clear()`
- `double get_Item(int)`
- `void set_Item(int, double)`

## `SharpForge.Runtime.Enumerator`1<bool>`

- `bool MoveNext()`
- `bool get_Current()`
- `void Dispose()`

## `System.Collections.Generic.List`1<bool>`

- `System.Collections.Generic.List`1<bool> .ctor()`
- `System.Collections.Generic.List`1<bool> .ctor(int)`
- `System.Collections.Generic.List`1<bool> .ctor(bool[])`
- `int get_Count()`
- `int get_Capacity()`
- `void set_Capacity(int)`
- `void Clear()`
- `bool Contains(bool)`
- `bool[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<bool> GetEnumerator()`
- `void Add(bool)`
- `void AddRange(bool[])`
- `void Insert(int, bool)`
- `bool Remove(bool)`
- `void RemoveAt(int)`
- `void RemoveRange(int, int)`
- `int IndexOf(bool)`
- `bool get_Item(int)`
- `void set_Item(int, bool)`
- `void Reverse()`
- `void Sort()`

## `System.Collections.Generic.HashSet`1<bool>`

- `System.Collections.Generic.HashSet`1<bool> .ctor()`
- `System.Collections.Generic.HashSet`1<bool> .ctor(int)`
- `System.Collections.Generic.HashSet`1<bool> .ctor(bool[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(bool)`
- `bool[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<bool> GetEnumerator()`
- `bool Add(bool)`
- `bool Remove(bool)`
- `void UnionWith(bool[])`
- `void IntersectWith(bool[])`
- `void ExceptWith(bool[])`

## `System.Collections.Generic.Queue`1<bool>`

- `System.Collections.Generic.Queue`1<bool> .ctor()`
- `System.Collections.Generic.Queue`1<bool> .ctor(int)`
- `System.Collections.Generic.Queue`1<bool> .ctor(bool[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(bool)`
- `bool[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<bool> GetEnumerator()`
- `void Enqueue(bool)`
- `bool Dequeue()`
- `bool Peek()`

## `System.Collections.Generic.Stack`1<bool>`

- `System.Collections.Generic.Stack`1<bool> .ctor()`
- `System.Collections.Generic.Stack`1<bool> .ctor(int)`
- `System.Collections.Generic.Stack`1<bool> .ctor(bool[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(bool)`
- `bool[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<bool> GetEnumerator()`
- `void Push(bool)`
- `bool Pop()`
- `bool Peek()`

## `System.Collections.Generic.Dictionary`2<string, bool>`

- `System.Collections.Generic.Dictionary`2<string, bool> .ctor()`
- `System.Collections.Generic.Dictionary`2<string, bool> .ctor(int)`
- `int get_Count()`
- `string[] get_Keys()`
- `bool[] get_Values()`
- `void Add(string, bool)`
- `bool TryAdd(string, bool)`
- `bool ContainsKey(string)`
- `bool ContainsValue(bool)`
- `bool Remove(string)`
- `void Clear()`
- `bool get_Item(string)`
- `void set_Item(string, bool)`

## `System.Collections.Generic.Dictionary`2<int, bool>`

- `System.Collections.Generic.Dictionary`2<int, bool> .ctor()`
- `System.Collections.Generic.Dictionary`2<int, bool> .ctor(int)`
- `int get_Count()`
- `int[] get_Keys()`
- `bool[] get_Values()`
- `void Add(int, bool)`
- `bool TryAdd(int, bool)`
- `bool ContainsKey(int)`
- `bool ContainsValue(bool)`
- `bool Remove(int)`
- `void Clear()`
- `bool get_Item(int)`
- `void set_Item(int, bool)`

## `SharpForge.Runtime.Enumerator`1<string>`

- `bool MoveNext()`
- `string get_Current()`
- `void Dispose()`

## `System.Collections.Generic.List`1<string>`

- `System.Collections.Generic.List`1<string> .ctor()`
- `System.Collections.Generic.List`1<string> .ctor(int)`
- `System.Collections.Generic.List`1<string> .ctor(string[])`
- `int get_Count()`
- `int get_Capacity()`
- `void set_Capacity(int)`
- `void Clear()`
- `bool Contains(string)`
- `string[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<string> GetEnumerator()`
- `void Add(string)`
- `void AddRange(string[])`
- `void Insert(int, string)`
- `bool Remove(string)`
- `void RemoveAt(int)`
- `void RemoveRange(int, int)`
- `int IndexOf(string)`
- `string get_Item(int)`
- `void set_Item(int, string)`
- `void Reverse()`
- `void Sort()`

## `System.Collections.Generic.HashSet`1<string>`

- `System.Collections.Generic.HashSet`1<string> .ctor()`
- `System.Collections.Generic.HashSet`1<string> .ctor(int)`
- `System.Collections.Generic.HashSet`1<string> .ctor(string[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(string)`
- `string[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<string> GetEnumerator()`
- `bool Add(string)`
- `bool Remove(string)`
- `void UnionWith(string[])`
- `void IntersectWith(string[])`
- `void ExceptWith(string[])`

## `System.Collections.Generic.Queue`1<string>`

- `System.Collections.Generic.Queue`1<string> .ctor()`
- `System.Collections.Generic.Queue`1<string> .ctor(int)`
- `System.Collections.Generic.Queue`1<string> .ctor(string[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(string)`
- `string[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<string> GetEnumerator()`
- `void Enqueue(string)`
- `string Dequeue()`
- `string Peek()`

## `System.Collections.Generic.Stack`1<string>`

- `System.Collections.Generic.Stack`1<string> .ctor()`
- `System.Collections.Generic.Stack`1<string> .ctor(int)`
- `System.Collections.Generic.Stack`1<string> .ctor(string[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(string)`
- `string[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<string> GetEnumerator()`
- `void Push(string)`
- `string Pop()`
- `string Peek()`

## `System.Collections.Generic.Dictionary`2<string, string>`

- `System.Collections.Generic.Dictionary`2<string, string> .ctor()`
- `System.Collections.Generic.Dictionary`2<string, string> .ctor(int)`
- `int get_Count()`
- `string[] get_Keys()`
- `string[] get_Values()`
- `void Add(string, string)`
- `bool TryAdd(string, string)`
- `bool ContainsKey(string)`
- `bool ContainsValue(string)`
- `bool Remove(string)`
- `void Clear()`
- `string get_Item(string)`
- `void set_Item(string, string)`

## `System.Collections.Generic.Dictionary`2<int, string>`

- `System.Collections.Generic.Dictionary`2<int, string> .ctor()`
- `System.Collections.Generic.Dictionary`2<int, string> .ctor(int)`
- `int get_Count()`
- `int[] get_Keys()`
- `string[] get_Values()`
- `void Add(int, string)`
- `bool TryAdd(int, string)`
- `bool ContainsKey(int)`
- `bool ContainsValue(string)`
- `bool Remove(int)`
- `void Clear()`
- `string get_Item(int)`
- `void set_Item(int, string)`

## `SharpForge.Runtime.Enumerator`1<object>`

- `bool MoveNext()`
- `object get_Current()`
- `void Dispose()`

## `System.Collections.Generic.List`1<object>`

- `System.Collections.Generic.List`1<object> .ctor()`
- `System.Collections.Generic.List`1<object> .ctor(int)`
- `System.Collections.Generic.List`1<object> .ctor(object[])`
- `int get_Count()`
- `int get_Capacity()`
- `void set_Capacity(int)`
- `void Clear()`
- `bool Contains(object)`
- `object[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<object> GetEnumerator()`
- `void Add(object)`
- `void AddRange(object[])`
- `void Insert(int, object)`
- `bool Remove(object)`
- `void RemoveAt(int)`
- `void RemoveRange(int, int)`
- `int IndexOf(object)`
- `object get_Item(int)`
- `void set_Item(int, object)`
- `void Reverse()`
- `void Sort()`

## `System.Collections.Generic.HashSet`1<object>`

- `System.Collections.Generic.HashSet`1<object> .ctor()`
- `System.Collections.Generic.HashSet`1<object> .ctor(int)`
- `System.Collections.Generic.HashSet`1<object> .ctor(object[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(object)`
- `object[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<object> GetEnumerator()`
- `bool Add(object)`
- `bool Remove(object)`
- `void UnionWith(object[])`
- `void IntersectWith(object[])`
- `void ExceptWith(object[])`

## `System.Collections.Generic.Queue`1<object>`

- `System.Collections.Generic.Queue`1<object> .ctor()`
- `System.Collections.Generic.Queue`1<object> .ctor(int)`
- `System.Collections.Generic.Queue`1<object> .ctor(object[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(object)`
- `object[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<object> GetEnumerator()`
- `void Enqueue(object)`
- `object Dequeue()`
- `object Peek()`

## `System.Collections.Generic.Stack`1<object>`

- `System.Collections.Generic.Stack`1<object> .ctor()`
- `System.Collections.Generic.Stack`1<object> .ctor(int)`
- `System.Collections.Generic.Stack`1<object> .ctor(object[])`
- `int get_Count()`
- `void Clear()`
- `bool Contains(object)`
- `object[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<object> GetEnumerator()`
- `void Push(object)`
- `object Pop()`
- `object Peek()`

## `System.Collections.Generic.Dictionary`2<string, object>`

- `System.Collections.Generic.Dictionary`2<string, object> .ctor()`
- `System.Collections.Generic.Dictionary`2<string, object> .ctor(int)`
- `int get_Count()`
- `string[] get_Keys()`
- `object[] get_Values()`
- `void Add(string, object)`
- `bool TryAdd(string, object)`
- `bool ContainsKey(string)`
- `bool ContainsValue(object)`
- `bool Remove(string)`
- `void Clear()`
- `object get_Item(string)`
- `void set_Item(string, object)`

## `System.Collections.Generic.Dictionary`2<int, object>`

- `System.Collections.Generic.Dictionary`2<int, object> .ctor()`
- `System.Collections.Generic.Dictionary`2<int, object> .ctor(int)`
- `int get_Count()`
- `int[] get_Keys()`
- `object[] get_Values()`
- `void Add(int, object)`
- `bool TryAdd(int, object)`
- `bool ContainsKey(int)`
- `bool ContainsValue(object)`
- `bool Remove(int)`
- `void Clear()`
- `object get_Item(int)`
- `void set_Item(int, object)`

## `System.String`

- `static string get_Empty()`
- `static bool IsNullOrEmpty(string)`
- `static bool IsNullOrWhiteSpace(string)`
- `static string Concat(string, string)`
- `static string Concat(string[])`
- `static string Join(string, string[])`
- `static string Join(string, int[])`
- `static bool Equals(string, string)`
- `static int CompareOrdinal(string, string)`
- `string ToString()`
- `string Substring(int)`
- `string Substring(int, int)`
- `bool Contains(string)`
- `int IndexOf(string)`
- `int IndexOf(string, int)`
- `int LastIndexOf(string)`
- `bool StartsWith(string)`
- `bool EndsWith(string)`
- `string Trim()`
- `string TrimStart()`
- `string TrimEnd()`
- `string ToUpperInvariant()`
- `string ToLowerInvariant()`
- `string ToUpper()`
- `string ToLower()`
- `string Replace(string, string)`
- `string[] Split(string)`
- `string[] Split(string, int)`
- `string PadLeft(int)`
- `string PadRight(int)`
- `string Remove(int)`
- `string Remove(int, int)`
- `string Insert(int, string)`
- `int get_Length()`
- `static string Format(string, object)`
- `static string Format(string, object, object)`
- `static string Format(string, object, object, object)`
- `static string Format(string, object, object, object, object)`
- `static string Format(string, object[])`

## `SharpForge.Runtime.Formatting`

- `static object BoxValue(object, string)`
- `static string FormatValue(object, string, int, string)`

## `System.Math`

- `static double Sin(double)`
- `static double Cos(double)`
- `static double Tan(double)`
- `static double Asin(double)`
- `static double Acos(double)`
- `static double Atan(double)`
- `static double Log(double)`
- `static double Log10(double)`
- `static double Exp(double)`
- `static double Truncate(double)`
- `static double Atan2(double, double)`
- `static int Clamp(int, int, int)`
- `static double Clamp(double, double, double)`
- `static double get_PI()`
- `static double get_E()`

<!-- bcl-module-inventory:start -->
## Registered BCL modules and pinned reference status

Generated by `node packages/bcl-core/scripts/inventory.js`. The released contract lists above remain available for existing links.

Reference: .NET 10.0.5, reference pack 10.0.5, SDK 10.0.201.
The snapshot contains public metadata for String, StringBuilder, Array and Random; inherited members are not expanded.
“Implemented” means an exact registered signature exists. It does not establish behavioral parity on any execution engine.
Closed Array overloads do not satisfy open generic reference signatures. Fields and properties remain distinct metadata kinds.

Reference source and extractor hashes are retained in [the pinned snapshot](../packages/bcl-core/reference/dotnet-10.0.5.json).
Use `node packages/bcl-core/scripts/inventory.js --check` to reject stale or missing registered-member documentation.

### Module <code>string-builder</code>

Registered families: <code>builder</code>.

| ABI ID | Registered signature | Registry status |
| --- | --- | --- |
| 795 | <code>System.Text.StringBuilder System.Text.StringBuilder::.ctor()</code> | implemented |
| 796 | <code>System.Text.StringBuilder System.Text.StringBuilder::.ctor(int)</code> | implemented |
| 797 | <code>System.Text.StringBuilder System.Text.StringBuilder::.ctor(string)</code> | implemented |
| 798 | <code>System.Text.StringBuilder System.Text.StringBuilder::.ctor(string, int)</code> | implemented |
| 799 | <code>int System.Text.StringBuilder::get_Length()</code> | implemented |
| 800 | <code>void System.Text.StringBuilder::set_Length(int)</code> | implemented |
| 801 | <code>int System.Text.StringBuilder::get_Capacity()</code> | implemented |
| 802 | <code>void System.Text.StringBuilder::set_Capacity(int)</code> | implemented |
| 803 | <code>int System.Text.StringBuilder::get_MaxCapacity()</code> | implemented |
| 804 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(int)</code> | implemented |
| 805 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(double)</code> | implemented |
| 806 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(bool)</code> | implemented |
| 807 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(string)</code> | implemented |
| 808 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(object)</code> | implemented |
| 809 | <code>System.Text.StringBuilder System.Text.StringBuilder::AppendLine()</code> | implemented |
| 810 | <code>System.Text.StringBuilder System.Text.StringBuilder::AppendLine(string)</code> | implemented |
| 811 | <code>System.Text.StringBuilder System.Text.StringBuilder::Clear()</code> | implemented |
| 812 | <code>string System.Text.StringBuilder::ToString()</code> | implemented |
| 813 | <code>string System.Text.StringBuilder::ToString(int, int)</code> | implemented |
| 814 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, string)</code> | implemented |
| 815 | <code>System.Text.StringBuilder System.Text.StringBuilder::Remove(int, int)</code> | implemented |
| 816 | <code>System.Text.StringBuilder System.Text.StringBuilder::Replace(string, string)</code> | implemented |
| 817 | <code>int System.Text.StringBuilder::EnsureCapacity(int)</code> | implemented |
| 818 | <code>System.Text.StringBuilder System.Text.StringBuilder::AppendFormat(string, object)</code> | implemented |
| 819 | <code>System.Text.StringBuilder System.Text.StringBuilder::AppendFormat(string, object, object)</code> | implemented |
| 820 | <code>System.Text.StringBuilder System.Text.StringBuilder::AppendFormat(string, object, object, object)</code> | implemented |
| 524288 | <code>System.Text.StringBuilder System.Text.StringBuilder::AppendFormat(string, object[])</code> | implemented |
| 524309 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(char)</code> | implemented |
| 524310 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(char, int)</code> | implemented |
| 524312 | <code>char System.Text.StringBuilder::get_Chars(int)</code> | implemented |
| 524313 | <code>void System.Text.StringBuilder::set_Chars(int, char)</code> | implemented |
| 524315 | <code>void System.Text.StringBuilder::CopyTo(int, char[], int, int)</code> | implemented |
| 524316 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(long)</code> | implemented |
| 524317 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(ulong)</code> | implemented |
| 524319 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(string, int, int)</code> | implemented |
| 524320 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(char[])</code> | implemented |
| 524321 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(char[], int, int)</code> | implemented |
| 524323 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(System.Text.StringBuilder)</code> | implemented |
| 524324 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(sbyte)</code> | implemented |
| 524325 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(byte)</code> | implemented |
| 524326 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(short)</code> | implemented |
| 524327 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(ushort)</code> | implemented |
| 524328 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(uint)</code> | implemented |
| 524330 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(float)</code> | implemented |
| 524331 | <code>bool System.Text.StringBuilder::Equals(System.Text.StringBuilder)</code> | implemented |
| 524332 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(decimal)</code> | implemented |
| 524333 | <code>System.Text.StringBuilder System.Text.StringBuilder::Append(System.Text.StringBuilder, int, int)</code> | implemented |
| 524334 | <code>System.Text.StringBuilder System.Text.StringBuilder::Replace(char, char)</code> | implemented |
| 524335 | <code>System.Text.StringBuilder System.Text.StringBuilder::Replace(char, char, int, int)</code> | implemented |
| 524336 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, char)</code> | implemented |
| 524337 | <code>System.Text.StringBuilder System.Text.StringBuilder::Replace(string, string, int, int)</code> | implemented |
| 524338 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, bool)</code> | implemented |
| 524339 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, string, int)</code> | implemented |
| 524340 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, sbyte)</code> | implemented |
| 524341 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, byte)</code> | implemented |
| 524342 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, short)</code> | implemented |
| 524343 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, ushort)</code> | implemented |
| 524344 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, int)</code> | implemented |
| 524345 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, uint)</code> | implemented |
| 524346 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, long)</code> | implemented |
| 524347 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, ulong)</code> | implemented |
| 524348 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, float)</code> | implemented |
| 524349 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, double)</code> | implemented |
| 524350 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, decimal)</code> | implemented |
| 524351 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, object)</code> | implemented |
| 524352 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, char[])</code> | implemented |
| 524353 | <code>System.Text.StringBuilder System.Text.StringBuilder::Insert(int, char[], int, int)</code> | implemented |

Pinned reference: 71 implemented and 37 missing exact metadata rows.

| Reference kind | Exact reference signature | Status | Matching ABI IDs |
| --- | --- | --- | --- |
| type | <code>System.Text.StringBuilder</code> | implemented | — |
| method | <code>System.Text.StringBuilder::.ctor``0():System.Void instance</code> | implemented | 795 |
| method | <code>System.Text.StringBuilder::.ctor``0(System.Int32):System.Void instance</code> | implemented | 796 |
| method | <code>System.Text.StringBuilder::.ctor``0(System.Int32,System.Int32):System.Void instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::.ctor``0(System.String):System.Void instance</code> | implemented | 797 |
| method | <code>System.Text.StringBuilder::.ctor``0(System.String,System.Int32):System.Void instance</code> | implemented | 798 |
| method | <code>System.Text.StringBuilder::.ctor``0(System.String,System.Int32,System.Int32,System.Int32):System.Void instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::get_Capacity``0():System.Int32 instance</code> | implemented | 801 |
| method | <code>System.Text.StringBuilder::set_Capacity``0(System.Int32):System.Void instance</code> | implemented | 802 |
| method | <code>System.Text.StringBuilder::get_Chars``0(System.Int32):System.Char instance</code> | implemented | 524312 |
| method | <code>System.Text.StringBuilder::set_Chars``0(System.Int32,System.Char):System.Void instance</code> | implemented | 524313 |
| method | <code>System.Text.StringBuilder::get_Length``0():System.Int32 instance</code> | implemented | 799 |
| method | <code>System.Text.StringBuilder::set_Length``0(System.Int32):System.Void instance</code> | implemented | 800 |
| method | <code>System.Text.StringBuilder::get_MaxCapacity``0():System.Int32 instance</code> | implemented | 803 |
| method | <code>System.Text.StringBuilder::Append``0(System.Boolean):System.Text.StringBuilder instance</code> | implemented | 806 |
| method | <code>System.Text.StringBuilder::Append``0(System.Byte):System.Text.StringBuilder instance</code> | implemented | 524325 |
| method | <code>System.Text.StringBuilder::Append``0(System.Char):System.Text.StringBuilder instance</code> | implemented | 524309 |
| method | <code>System.Text.StringBuilder::Append``0(System.Char*,System.Int32):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::Append``0(System.Char,System.Int32):System.Text.StringBuilder instance</code> | implemented | 524310 |
| method | <code>System.Text.StringBuilder::Append``0(System.Char[]):System.Text.StringBuilder instance</code> | implemented | 524320 |
| method | <code>System.Text.StringBuilder::Append``0(System.Char[],System.Int32,System.Int32):System.Text.StringBuilder instance</code> | implemented | 524321 |
| method | <code>System.Text.StringBuilder::Append``0(System.Decimal):System.Text.StringBuilder instance</code> | implemented | 524332 |
| method | <code>System.Text.StringBuilder::Append``0(System.Double):System.Text.StringBuilder instance</code> | implemented | 805 |
| method | <code>System.Text.StringBuilder::Append``0(System.IFormatProvider,System.Text.StringBuilder+AppendInterpolatedStringHandler&amp;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::Append``0(System.Int16):System.Text.StringBuilder instance</code> | implemented | 524326 |
| method | <code>System.Text.StringBuilder::Append``0(System.Int32):System.Text.StringBuilder instance</code> | implemented | 804 |
| method | <code>System.Text.StringBuilder::Append``0(System.Int64):System.Text.StringBuilder instance</code> | implemented | 524316 |
| method | <code>System.Text.StringBuilder::Append``0(System.Object):System.Text.StringBuilder instance</code> | implemented | 808 |
| method | <code>System.Text.StringBuilder::Append``0(System.ReadOnlyMemory`1&lt;System.Char&gt;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::Append``0(System.ReadOnlySpan`1&lt;System.Char&gt;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::Append``0(System.SByte):System.Text.StringBuilder instance</code> | implemented | 524324 |
| method | <code>System.Text.StringBuilder::Append``0(System.Single):System.Text.StringBuilder instance</code> | implemented | 524330 |
| method | <code>System.Text.StringBuilder::Append``0(System.String):System.Text.StringBuilder instance</code> | implemented | 807 |
| method | <code>System.Text.StringBuilder::Append``0(System.String,System.Int32,System.Int32):System.Text.StringBuilder instance</code> | implemented | 524319 |
| method | <code>System.Text.StringBuilder::Append``0(System.Text.StringBuilder):System.Text.StringBuilder instance</code> | implemented | 524323 |
| method | <code>System.Text.StringBuilder::Append``0(System.Text.StringBuilder,System.Int32,System.Int32):System.Text.StringBuilder instance</code> | implemented | 524333 |
| method | <code>System.Text.StringBuilder::Append``0(System.Text.StringBuilder+AppendInterpolatedStringHandler&amp;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::Append``0(System.UInt16):System.Text.StringBuilder instance</code> | implemented | 524327 |
| method | <code>System.Text.StringBuilder::Append``0(System.UInt32):System.Text.StringBuilder instance</code> | implemented | 524328 |
| method | <code>System.Text.StringBuilder::Append``0(System.UInt64):System.Text.StringBuilder instance</code> | implemented | 524317 |
| method | <code>System.Text.StringBuilder::AppendFormat``0(System.IFormatProvider,System.String,System.Object):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendFormat``0(System.IFormatProvider,System.String,System.Object,System.Object):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendFormat``0(System.IFormatProvider,System.String,System.Object,System.Object,System.Object):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendFormat``0(System.IFormatProvider,System.String,System.Object[]):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendFormat``0(System.IFormatProvider,System.String,System.ReadOnlySpan`1&lt;System.Object&gt;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendFormat``0(System.IFormatProvider,System.Text.CompositeFormat,System.Object[]):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendFormat``0(System.IFormatProvider,System.Text.CompositeFormat,System.ReadOnlySpan`1&lt;System.Object&gt;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendFormat``0(System.String,System.Object):System.Text.StringBuilder instance</code> | implemented | 818 |
| method | <code>System.Text.StringBuilder::AppendFormat``0(System.String,System.Object,System.Object):System.Text.StringBuilder instance</code> | implemented | 819 |
| method | <code>System.Text.StringBuilder::AppendFormat``0(System.String,System.Object,System.Object,System.Object):System.Text.StringBuilder instance</code> | implemented | 820 |
| method | <code>System.Text.StringBuilder::AppendFormat``0(System.String,System.Object[]):System.Text.StringBuilder instance</code> | implemented | 524288 |
| method | <code>System.Text.StringBuilder::AppendFormat``0(System.String,System.ReadOnlySpan`1&lt;System.Object&gt;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendFormat``1(System.IFormatProvider,System.Text.CompositeFormat,!!0):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendFormat``2(System.IFormatProvider,System.Text.CompositeFormat,!!0,!!1):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendFormat``3(System.IFormatProvider,System.Text.CompositeFormat,!!0,!!1,!!2):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendJoin``0(System.Char,System.Object[]):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendJoin``0(System.Char,System.String[]):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendJoin``0(System.Char,System.ReadOnlySpan`1&lt;System.Object&gt;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendJoin``0(System.Char,System.ReadOnlySpan`1&lt;System.String&gt;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendJoin``0(System.String,System.Object[]):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendJoin``0(System.String,System.String[]):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendJoin``0(System.String,System.ReadOnlySpan`1&lt;System.Object&gt;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendJoin``0(System.String,System.ReadOnlySpan`1&lt;System.String&gt;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendJoin``1(System.Char,System.Collections.Generic.IEnumerable`1&lt;!!0&gt;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendJoin``1(System.String,System.Collections.Generic.IEnumerable`1&lt;!!0&gt;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendLine``0():System.Text.StringBuilder instance</code> | implemented | 809 |
| method | <code>System.Text.StringBuilder::AppendLine``0(System.IFormatProvider,System.Text.StringBuilder+AppendInterpolatedStringHandler&amp;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::AppendLine``0(System.String):System.Text.StringBuilder instance</code> | implemented | 810 |
| method | <code>System.Text.StringBuilder::AppendLine``0(System.Text.StringBuilder+AppendInterpolatedStringHandler&amp;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::Clear``0():System.Text.StringBuilder instance</code> | implemented | 811 |
| method | <code>System.Text.StringBuilder::CopyTo``0(System.Int32,System.Char[],System.Int32,System.Int32):System.Void instance</code> | implemented | 524315 |
| method | <code>System.Text.StringBuilder::CopyTo``0(System.Int32,System.Span`1&lt;System.Char&gt;,System.Int32):System.Void instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::EnsureCapacity``0(System.Int32):System.Int32 instance</code> | implemented | 817 |
| method | <code>System.Text.StringBuilder::Equals``0(System.ReadOnlySpan`1&lt;System.Char&gt;):System.Boolean instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::Equals``0(System.Text.StringBuilder):System.Boolean instance</code> | implemented | 524331 |
| method | <code>System.Text.StringBuilder::GetChunks``0():System.Text.StringBuilder+ChunkEnumerator instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.Boolean):System.Text.StringBuilder instance</code> | implemented | 524338 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.Byte):System.Text.StringBuilder instance</code> | implemented | 524341 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.Char):System.Text.StringBuilder instance</code> | implemented | 524336 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.Char[]):System.Text.StringBuilder instance</code> | implemented | 524352 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.Char[],System.Int32,System.Int32):System.Text.StringBuilder instance</code> | implemented | 524353 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.Decimal):System.Text.StringBuilder instance</code> | implemented | 524350 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.Double):System.Text.StringBuilder instance</code> | implemented | 524349 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.Int16):System.Text.StringBuilder instance</code> | implemented | 524342 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.Int32):System.Text.StringBuilder instance</code> | implemented | 524344 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.Int64):System.Text.StringBuilder instance</code> | implemented | 524346 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.Object):System.Text.StringBuilder instance</code> | implemented | 524351 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.ReadOnlySpan`1&lt;System.Char&gt;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.SByte):System.Text.StringBuilder instance</code> | implemented | 524340 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.Single):System.Text.StringBuilder instance</code> | implemented | 524348 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.String):System.Text.StringBuilder instance</code> | implemented | 814 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.String,System.Int32):System.Text.StringBuilder instance</code> | implemented | 524339 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.UInt16):System.Text.StringBuilder instance</code> | implemented | 524343 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.UInt32):System.Text.StringBuilder instance</code> | implemented | 524345 |
| method | <code>System.Text.StringBuilder::Insert``0(System.Int32,System.UInt64):System.Text.StringBuilder instance</code> | implemented | 524347 |
| method | <code>System.Text.StringBuilder::Remove``0(System.Int32,System.Int32):System.Text.StringBuilder instance</code> | implemented | 815 |
| method | <code>System.Text.StringBuilder::Replace``0(System.Char,System.Char):System.Text.StringBuilder instance</code> | implemented | 524334 |
| method | <code>System.Text.StringBuilder::Replace``0(System.Char,System.Char,System.Int32,System.Int32):System.Text.StringBuilder instance</code> | implemented | 524335 |
| method | <code>System.Text.StringBuilder::Replace``0(System.ReadOnlySpan`1&lt;System.Char&gt;,System.ReadOnlySpan`1&lt;System.Char&gt;):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::Replace``0(System.ReadOnlySpan`1&lt;System.Char&gt;,System.ReadOnlySpan`1&lt;System.Char&gt;,System.Int32,System.Int32):System.Text.StringBuilder instance</code> | missing | — |
| method | <code>System.Text.StringBuilder::Replace``0(System.String,System.String):System.Text.StringBuilder instance</code> | implemented | 816 |
| method | <code>System.Text.StringBuilder::Replace``0(System.String,System.String,System.Int32,System.Int32):System.Text.StringBuilder instance</code> | implemented | 524337 |
| method | <code>System.Text.StringBuilder::ToString``0():System.String instance</code> | implemented | 812 |
| method | <code>System.Text.StringBuilder::ToString``0(System.Int32,System.Int32):System.String instance</code> | implemented | 813 |
| property | <code>System.Text.StringBuilder::Capacity[]:System.Int32 get set instance</code> | implemented | 801, 802 |
| property | <code>System.Text.StringBuilder::Chars[System.Int32]:System.Char get set instance</code> | missing | — |
| property | <code>System.Text.StringBuilder::Length[]:System.Int32 get set instance</code> | implemented | 799, 800 |
| property | <code>System.Text.StringBuilder::MaxCapacity[]:System.Int32 get instance</code> | implemented | 803 |

### Module <code>string</code>

Registered families: <code>string</code>.

| ABI ID | Registered signature | Registry status |
| --- | --- | --- |
| 1246 | <code>static string System.String::get_Empty()</code> | implemented |
| 1247 | <code>static bool System.String::IsNullOrEmpty(string)</code> | implemented |
| 1248 | <code>static bool System.String::IsNullOrWhiteSpace(string)</code> | implemented |
| 1249 | <code>static string System.String::Concat(string, string)</code> | implemented |
| 1250 | <code>static string System.String::Concat(string[])</code> | implemented |
| 1251 | <code>static string System.String::Join(string, string[])</code> | implemented |
| 1252 | <code>static string System.String::Join(string, int[])</code> | implemented |
| 1253 | <code>static bool System.String::Equals(string, string)</code> | implemented |
| 1254 | <code>static int System.String::CompareOrdinal(string, string)</code> | implemented |
| 1255 | <code>string System.String::ToString()</code> | implemented |
| 1256 | <code>string System.String::Substring(int)</code> | implemented |
| 1257 | <code>string System.String::Substring(int, int)</code> | implemented |
| 1258 | <code>bool System.String::Contains(string)</code> | implemented |
| 1259 | <code>int System.String::IndexOf(string)</code> | implemented |
| 1260 | <code>int System.String::IndexOf(string, int)</code> | implemented |
| 1261 | <code>int System.String::LastIndexOf(string)</code> | implemented |
| 1262 | <code>bool System.String::StartsWith(string)</code> | implemented |
| 1263 | <code>bool System.String::EndsWith(string)</code> | implemented |
| 1264 | <code>string System.String::Trim()</code> | implemented |
| 1265 | <code>string System.String::TrimStart()</code> | implemented |
| 1266 | <code>string System.String::TrimEnd()</code> | implemented |
| 1267 | <code>string System.String::ToUpperInvariant()</code> | implemented |
| 1268 | <code>string System.String::ToLowerInvariant()</code> | implemented |
| 1269 | <code>string System.String::ToUpper()</code> | implemented |
| 1270 | <code>string System.String::ToLower()</code> | implemented |
| 1271 | <code>string System.String::Replace(string, string)</code> | implemented |
| 1272 | <code>string[] System.String::Split(string)</code> | implemented |
| 1273 | <code>string[] System.String::Split(string, int)</code> | implemented |
| 1274 | <code>string System.String::PadLeft(int)</code> | implemented |
| 1275 | <code>string System.String::PadRight(int)</code> | implemented |
| 1276 | <code>string System.String::Remove(int)</code> | implemented |
| 1277 | <code>string System.String::Remove(int, int)</code> | implemented |
| 1278 | <code>string System.String::Insert(int, string)</code> | implemented |
| 1279 | <code>int System.String::get_Length()</code> | implemented |
| 1280 | <code>static string System.String::Format(string, object)</code> | implemented |
| 1281 | <code>static string System.String::Format(string, object, object)</code> | implemented |
| 1282 | <code>static string System.String::Format(string, object, object, object)</code> | implemented |
| 1283 | <code>static string System.String::Format(string, object, object, object, object)</code> | implemented |
| 1284 | <code>static string System.String::Format(string, object[])</code> | implemented |
| 524298 | <code>static int System.String::CompareOrdinal(string, int, string, int, int)</code> | implemented |
| 524299 | <code>static bool System.String::Equals(string, string, System.StringComparison)</code> | implemented |
| 524300 | <code>bool System.String::Equals(string, System.StringComparison)</code> | implemented |
| 524301 | <code>static int System.String::Compare(string, string, System.StringComparison)</code> | implemented |
| 524302 | <code>bool System.String::StartsWith(string, System.StringComparison)</code> | implemented |
| 524303 | <code>bool System.String::EndsWith(string, System.StringComparison)</code> | implemented |
| 524304 | <code>static int System.String::Compare(string, int, string, int, int, System.StringComparison)</code> | implemented |
| 524305 | <code>bool System.String::Contains(string, System.StringComparison)</code> | implemented |
| 524306 | <code>int System.String::IndexOf(string, System.StringComparison)</code> | implemented |
| 524307 | <code>int System.String::LastIndexOf(string, System.StringComparison)</code> | implemented |
| 524308 | <code>int System.String::IndexOf(string, int, System.StringComparison)</code> | implemented |
| 524311 | <code>int System.String::IndexOf(string, int, int, System.StringComparison)</code> | implemented |
| 524314 | <code>int System.String::LastIndexOf(string, int, System.StringComparison)</code> | implemented |
| 524318 | <code>int System.String::LastIndexOf(string, int, int, System.StringComparison)</code> | implemented |

Pinned reference: 50 implemented and 136 missing exact metadata rows.

| Reference kind | Exact reference signature | Status | Matching ABI IDs |
| --- | --- | --- | --- |
| type | <code>System.String</code> | implemented | — |
| method | <code>System.String::.ctor``0(System.Char*):System.Void instance</code> | missing | — |
| method | <code>System.String::.ctor``0(System.Char*,System.Int32,System.Int32):System.Void instance</code> | missing | — |
| method | <code>System.String::.ctor``0(System.Char,System.Int32):System.Void instance</code> | missing | — |
| method | <code>System.String::.ctor``0(System.Char[]):System.Void instance</code> | missing | — |
| method | <code>System.String::.ctor``0(System.Char[],System.Int32,System.Int32):System.Void instance</code> | missing | — |
| method | <code>System.String::.ctor``0(System.ReadOnlySpan`1&lt;System.Char&gt;):System.Void instance</code> | missing | — |
| method | <code>System.String::.ctor``0(System.SByte*):System.Void instance</code> | missing | — |
| method | <code>System.String::.ctor``0(System.SByte*,System.Int32,System.Int32):System.Void instance</code> | missing | — |
| method | <code>System.String::.ctor``0(System.SByte*,System.Int32,System.Int32,System.Text.Encoding):System.Void instance</code> | missing | — |
| method | <code>System.String::get_Chars``0(System.Int32):System.Char instance</code> | missing | — |
| method | <code>System.String::get_Length``0():System.Int32 instance</code> | implemented | 1279 |
| method | <code>System.String::Clone``0():System.Object instance</code> | missing | — |
| method | <code>System.String::Compare``0(System.String,System.Int32,System.String,System.Int32,System.Int32):System.Int32 static</code> | missing | — |
| method | <code>System.String::Compare``0(System.String,System.Int32,System.String,System.Int32,System.Int32,System.Boolean):System.Int32 static</code> | missing | — |
| method | <code>System.String::Compare``0(System.String,System.Int32,System.String,System.Int32,System.Int32,System.Boolean,System.Globalization.CultureInfo):System.Int32 static</code> | missing | — |
| method | <code>System.String::Compare``0(System.String,System.Int32,System.String,System.Int32,System.Int32,System.Globalization.CultureInfo,System.Globalization.CompareOptions):System.Int32 static</code> | missing | — |
| method | <code>System.String::Compare``0(System.String,System.Int32,System.String,System.Int32,System.Int32,System.StringComparison):System.Int32 static</code> | implemented | 524304 |
| method | <code>System.String::Compare``0(System.String,System.String):System.Int32 static</code> | missing | — |
| method | <code>System.String::Compare``0(System.String,System.String,System.Boolean):System.Int32 static</code> | missing | — |
| method | <code>System.String::Compare``0(System.String,System.String,System.Boolean,System.Globalization.CultureInfo):System.Int32 static</code> | missing | — |
| method | <code>System.String::Compare``0(System.String,System.String,System.Globalization.CultureInfo,System.Globalization.CompareOptions):System.Int32 static</code> | missing | — |
| method | <code>System.String::Compare``0(System.String,System.String,System.StringComparison):System.Int32 static</code> | implemented | 524301 |
| method | <code>System.String::CompareOrdinal``0(System.String,System.Int32,System.String,System.Int32,System.Int32):System.Int32 static</code> | implemented | 524298 |
| method | <code>System.String::CompareOrdinal``0(System.String,System.String):System.Int32 static</code> | implemented | 1254 |
| method | <code>System.String::CompareTo``0(System.Object):System.Int32 instance</code> | missing | — |
| method | <code>System.String::CompareTo``0(System.String):System.Int32 instance</code> | missing | — |
| method | <code>System.String::Concat``0(System.Collections.Generic.IEnumerable`1&lt;System.String&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Concat``0(System.Object):System.String static</code> | missing | — |
| method | <code>System.String::Concat``0(System.Object,System.Object):System.String static</code> | missing | — |
| method | <code>System.String::Concat``0(System.Object,System.Object,System.Object):System.String static</code> | missing | — |
| method | <code>System.String::Concat``0(System.Object[]):System.String static</code> | missing | — |
| method | <code>System.String::Concat``0(System.ReadOnlySpan`1&lt;System.Object&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Concat``0(System.ReadOnlySpan`1&lt;System.Char&gt;,System.ReadOnlySpan`1&lt;System.Char&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Concat``0(System.ReadOnlySpan`1&lt;System.Char&gt;,System.ReadOnlySpan`1&lt;System.Char&gt;,System.ReadOnlySpan`1&lt;System.Char&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Concat``0(System.ReadOnlySpan`1&lt;System.Char&gt;,System.ReadOnlySpan`1&lt;System.Char&gt;,System.ReadOnlySpan`1&lt;System.Char&gt;,System.ReadOnlySpan`1&lt;System.Char&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Concat``0(System.String,System.String):System.String static</code> | implemented | 1249 |
| method | <code>System.String::Concat``0(System.String,System.String,System.String):System.String static</code> | missing | — |
| method | <code>System.String::Concat``0(System.String,System.String,System.String,System.String):System.String static</code> | missing | — |
| method | <code>System.String::Concat``0(System.String[]):System.String static</code> | implemented | 1250 |
| method | <code>System.String::Concat``0(System.ReadOnlySpan`1&lt;System.String&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Concat``1(System.Collections.Generic.IEnumerable`1&lt;!!0&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Contains``0(System.Char):System.Boolean instance</code> | missing | — |
| method | <code>System.String::Contains``0(System.Char,System.StringComparison):System.Boolean instance</code> | missing | — |
| method | <code>System.String::Contains``0(System.String):System.Boolean instance</code> | implemented | 1258 |
| method | <code>System.String::Contains``0(System.String,System.StringComparison):System.Boolean instance</code> | implemented | 524305 |
| method | <code>System.String::Copy``0(System.String):System.String static</code> | missing | — |
| method | <code>System.String::CopyTo``0(System.Int32,System.Char[],System.Int32,System.Int32):System.Void instance</code> | missing | — |
| method | <code>System.String::CopyTo``0(System.Span`1&lt;System.Char&gt;):System.Void instance</code> | missing | — |
| method | <code>System.String::Create``0(System.IFormatProvider,System.Runtime.CompilerServices.DefaultInterpolatedStringHandler&amp;):System.String static</code> | missing | — |
| method | <code>System.String::Create``0(System.IFormatProvider,System.Span`1&lt;System.Char&gt;,System.Runtime.CompilerServices.DefaultInterpolatedStringHandler&amp;):System.String static</code> | missing | — |
| method | <code>System.String::Create``1(System.Int32,!!0,System.Buffers.SpanAction`2&lt;System.Char,!!0&gt;):System.String static</code> | missing | — |
| method | <code>System.String::EndsWith``0(System.Char):System.Boolean instance</code> | missing | — |
| method | <code>System.String::EndsWith``0(System.String):System.Boolean instance</code> | implemented | 1263 |
| method | <code>System.String::EndsWith``0(System.String,System.Boolean,System.Globalization.CultureInfo):System.Boolean instance</code> | missing | — |
| method | <code>System.String::EndsWith``0(System.String,System.StringComparison):System.Boolean instance</code> | implemented | 524303 |
| method | <code>System.String::EnumerateRunes``0():System.Text.StringRuneEnumerator instance</code> | missing | — |
| method | <code>System.String::Equals``0(System.Object):System.Boolean instance</code> | missing | — |
| method | <code>System.String::Equals``0(System.String):System.Boolean instance</code> | missing | — |
| method | <code>System.String::Equals``0(System.String,System.String):System.Boolean static</code> | implemented | 1253 |
| method | <code>System.String::Equals``0(System.String,System.String,System.StringComparison):System.Boolean static</code> | implemented | 524299 |
| method | <code>System.String::Equals``0(System.String,System.StringComparison):System.Boolean instance</code> | implemented | 524300 |
| method | <code>System.String::Format``0(System.IFormatProvider,System.String,System.Object):System.String static</code> | missing | — |
| method | <code>System.String::Format``0(System.IFormatProvider,System.String,System.Object,System.Object):System.String static</code> | missing | — |
| method | <code>System.String::Format``0(System.IFormatProvider,System.String,System.Object,System.Object,System.Object):System.String static</code> | missing | — |
| method | <code>System.String::Format``0(System.IFormatProvider,System.String,System.Object[]):System.String static</code> | missing | — |
| method | <code>System.String::Format``0(System.IFormatProvider,System.String,System.ReadOnlySpan`1&lt;System.Object&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Format``0(System.IFormatProvider,System.Text.CompositeFormat,System.Object[]):System.String static</code> | missing | — |
| method | <code>System.String::Format``0(System.IFormatProvider,System.Text.CompositeFormat,System.ReadOnlySpan`1&lt;System.Object&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Format``0(System.String,System.Object):System.String static</code> | implemented | 1280 |
| method | <code>System.String::Format``0(System.String,System.Object,System.Object):System.String static</code> | implemented | 1281 |
| method | <code>System.String::Format``0(System.String,System.Object,System.Object,System.Object):System.String static</code> | implemented | 1282 |
| method | <code>System.String::Format``0(System.String,System.Object[]):System.String static</code> | implemented | 1284 |
| method | <code>System.String::Format``0(System.String,System.ReadOnlySpan`1&lt;System.Object&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Format``1(System.IFormatProvider,System.Text.CompositeFormat,!!0):System.String static</code> | missing | — |
| method | <code>System.String::Format``2(System.IFormatProvider,System.Text.CompositeFormat,!!0,!!1):System.String static</code> | missing | — |
| method | <code>System.String::Format``3(System.IFormatProvider,System.Text.CompositeFormat,!!0,!!1,!!2):System.String static</code> | missing | — |
| method | <code>System.String::GetEnumerator``0():System.CharEnumerator instance</code> | missing | — |
| method | <code>System.String::GetHashCode``0():System.Int32 instance</code> | missing | — |
| method | <code>System.String::GetHashCode``0(System.ReadOnlySpan`1&lt;System.Char&gt;):System.Int32 static</code> | missing | — |
| method | <code>System.String::GetHashCode``0(System.ReadOnlySpan`1&lt;System.Char&gt;,System.StringComparison):System.Int32 static</code> | missing | — |
| method | <code>System.String::GetHashCode``0(System.StringComparison):System.Int32 instance</code> | missing | — |
| method | <code>System.String::GetPinnableReference``0():System.Char&amp; modreq(System.Runtime.InteropServices.InAttribute) instance</code> | missing | — |
| method | <code>System.String::GetTypeCode``0():System.TypeCode instance</code> | missing | — |
| method | <code>System.String::IndexOf``0(System.Char):System.Int32 instance</code> | missing | — |
| method | <code>System.String::IndexOf``0(System.Char,System.Int32):System.Int32 instance</code> | missing | — |
| method | <code>System.String::IndexOf``0(System.Char,System.Int32,System.Int32):System.Int32 instance</code> | missing | — |
| method | <code>System.String::IndexOf``0(System.Char,System.StringComparison):System.Int32 instance</code> | missing | — |
| method | <code>System.String::IndexOf``0(System.String):System.Int32 instance</code> | implemented | 1259 |
| method | <code>System.String::IndexOf``0(System.String,System.Int32):System.Int32 instance</code> | implemented | 1260 |
| method | <code>System.String::IndexOf``0(System.String,System.Int32,System.Int32):System.Int32 instance</code> | missing | — |
| method | <code>System.String::IndexOf``0(System.String,System.Int32,System.Int32,System.StringComparison):System.Int32 instance</code> | implemented | 524311 |
| method | <code>System.String::IndexOf``0(System.String,System.Int32,System.StringComparison):System.Int32 instance</code> | implemented | 524308 |
| method | <code>System.String::IndexOf``0(System.String,System.StringComparison):System.Int32 instance</code> | implemented | 524306 |
| method | <code>System.String::IndexOfAny``0(System.Char[]):System.Int32 instance</code> | missing | — |
| method | <code>System.String::IndexOfAny``0(System.Char[],System.Int32):System.Int32 instance</code> | missing | — |
| method | <code>System.String::IndexOfAny``0(System.Char[],System.Int32,System.Int32):System.Int32 instance</code> | missing | — |
| method | <code>System.String::Insert``0(System.Int32,System.String):System.String instance</code> | implemented | 1278 |
| method | <code>System.String::Intern``0(System.String):System.String static</code> | missing | — |
| method | <code>System.String::IsInterned``0(System.String):System.String static</code> | missing | — |
| method | <code>System.String::IsNormalized``0():System.Boolean instance</code> | missing | — |
| method | <code>System.String::IsNormalized``0(System.Text.NormalizationForm):System.Boolean instance</code> | missing | — |
| method | <code>System.String::IsNullOrEmpty``0(System.String):System.Boolean static</code> | implemented | 1247 |
| method | <code>System.String::IsNullOrWhiteSpace``0(System.String):System.Boolean static</code> | implemented | 1248 |
| method | <code>System.String::Join``0(System.Char,System.Object[]):System.String static</code> | missing | — |
| method | <code>System.String::Join``0(System.Char,System.ReadOnlySpan`1&lt;System.Object&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Join``0(System.Char,System.String[]):System.String static</code> | missing | — |
| method | <code>System.String::Join``0(System.Char,System.ReadOnlySpan`1&lt;System.String&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Join``0(System.Char,System.String[],System.Int32,System.Int32):System.String static</code> | missing | — |
| method | <code>System.String::Join``0(System.String,System.Collections.Generic.IEnumerable`1&lt;System.String&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Join``0(System.String,System.Object[]):System.String static</code> | missing | — |
| method | <code>System.String::Join``0(System.String,System.ReadOnlySpan`1&lt;System.Object&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Join``0(System.String,System.String[]):System.String static</code> | implemented | 1251 |
| method | <code>System.String::Join``0(System.String,System.ReadOnlySpan`1&lt;System.String&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Join``0(System.String,System.String[],System.Int32,System.Int32):System.String static</code> | missing | — |
| method | <code>System.String::Join``1(System.Char,System.Collections.Generic.IEnumerable`1&lt;!!0&gt;):System.String static</code> | missing | — |
| method | <code>System.String::Join``1(System.String,System.Collections.Generic.IEnumerable`1&lt;!!0&gt;):System.String static</code> | missing | — |
| method | <code>System.String::LastIndexOf``0(System.Char):System.Int32 instance</code> | missing | — |
| method | <code>System.String::LastIndexOf``0(System.Char,System.Int32):System.Int32 instance</code> | missing | — |
| method | <code>System.String::LastIndexOf``0(System.Char,System.Int32,System.Int32):System.Int32 instance</code> | missing | — |
| method | <code>System.String::LastIndexOf``0(System.String):System.Int32 instance</code> | implemented | 1261 |
| method | <code>System.String::LastIndexOf``0(System.String,System.Int32):System.Int32 instance</code> | missing | — |
| method | <code>System.String::LastIndexOf``0(System.String,System.Int32,System.Int32):System.Int32 instance</code> | missing | — |
| method | <code>System.String::LastIndexOf``0(System.String,System.Int32,System.Int32,System.StringComparison):System.Int32 instance</code> | implemented | 524318 |
| method | <code>System.String::LastIndexOf``0(System.String,System.Int32,System.StringComparison):System.Int32 instance</code> | implemented | 524314 |
| method | <code>System.String::LastIndexOf``0(System.String,System.StringComparison):System.Int32 instance</code> | implemented | 524307 |
| method | <code>System.String::LastIndexOfAny``0(System.Char[]):System.Int32 instance</code> | missing | — |
| method | <code>System.String::LastIndexOfAny``0(System.Char[],System.Int32):System.Int32 instance</code> | missing | — |
| method | <code>System.String::LastIndexOfAny``0(System.Char[],System.Int32,System.Int32):System.Int32 instance</code> | missing | — |
| method | <code>System.String::Normalize``0():System.String instance</code> | missing | — |
| method | <code>System.String::Normalize``0(System.Text.NormalizationForm):System.String instance</code> | missing | — |
| method | <code>System.String::op_Equality``0(System.String,System.String):System.Boolean static</code> | missing | — |
| method | <code>System.String::op_Implicit``0(System.String):System.ReadOnlySpan`1&lt;System.Char&gt; static</code> | missing | — |
| method | <code>System.String::op_Inequality``0(System.String,System.String):System.Boolean static</code> | missing | — |
| method | <code>System.String::PadLeft``0(System.Int32):System.String instance</code> | implemented | 1274 |
| method | <code>System.String::PadLeft``0(System.Int32,System.Char):System.String instance</code> | missing | — |
| method | <code>System.String::PadRight``0(System.Int32):System.String instance</code> | implemented | 1275 |
| method | <code>System.String::PadRight``0(System.Int32,System.Char):System.String instance</code> | missing | — |
| method | <code>System.String::Remove``0(System.Int32):System.String instance</code> | implemented | 1276 |
| method | <code>System.String::Remove``0(System.Int32,System.Int32):System.String instance</code> | implemented | 1277 |
| method | <code>System.String::Replace``0(System.Char,System.Char):System.String instance</code> | missing | — |
| method | <code>System.String::Replace``0(System.String,System.String):System.String instance</code> | implemented | 1271 |
| method | <code>System.String::Replace``0(System.String,System.String,System.Boolean,System.Globalization.CultureInfo):System.String instance</code> | missing | — |
| method | <code>System.String::Replace``0(System.String,System.String,System.StringComparison):System.String instance</code> | missing | — |
| method | <code>System.String::ReplaceLineEndings``0():System.String instance</code> | missing | — |
| method | <code>System.String::ReplaceLineEndings``0(System.String):System.String instance</code> | missing | — |
| method | <code>System.String::Split``0(System.Char,System.Int32,System.StringSplitOptions):System.String[] instance</code> | missing | — |
| method | <code>System.String::Split``0(System.Char,System.StringSplitOptions):System.String[] instance</code> | missing | — |
| method | <code>System.String::Split``0(System.Char[]):System.String[] instance</code> | missing | — |
| method | <code>System.String::Split``0(System.ReadOnlySpan`1&lt;System.Char&gt;):System.String[] instance</code> | missing | — |
| method | <code>System.String::Split``0(System.Char[],System.Int32):System.String[] instance</code> | missing | — |
| method | <code>System.String::Split``0(System.Char[],System.Int32,System.StringSplitOptions):System.String[] instance</code> | missing | — |
| method | <code>System.String::Split``0(System.Char[],System.StringSplitOptions):System.String[] instance</code> | missing | — |
| method | <code>System.String::Split``0(System.String,System.Int32,System.StringSplitOptions):System.String[] instance</code> | missing | — |
| method | <code>System.String::Split``0(System.String,System.StringSplitOptions):System.String[] instance</code> | missing | — |
| method | <code>System.String::Split``0(System.String[],System.Int32,System.StringSplitOptions):System.String[] instance</code> | missing | — |
| method | <code>System.String::Split``0(System.String[],System.StringSplitOptions):System.String[] instance</code> | missing | — |
| method | <code>System.String::StartsWith``0(System.Char):System.Boolean instance</code> | missing | — |
| method | <code>System.String::StartsWith``0(System.String):System.Boolean instance</code> | implemented | 1262 |
| method | <code>System.String::StartsWith``0(System.String,System.Boolean,System.Globalization.CultureInfo):System.Boolean instance</code> | missing | — |
| method | <code>System.String::StartsWith``0(System.String,System.StringComparison):System.Boolean instance</code> | implemented | 524302 |
| method | <code>System.String::Substring``0(System.Int32):System.String instance</code> | implemented | 1256 |
| method | <code>System.String::Substring``0(System.Int32,System.Int32):System.String instance</code> | implemented | 1257 |
| method | <code>System.String::ToCharArray``0():System.Char[] instance</code> | missing | — |
| method | <code>System.String::ToCharArray``0(System.Int32,System.Int32):System.Char[] instance</code> | missing | — |
| method | <code>System.String::ToLower``0():System.String instance</code> | implemented | 1270 |
| method | <code>System.String::ToLower``0(System.Globalization.CultureInfo):System.String instance</code> | missing | — |
| method | <code>System.String::ToLowerInvariant``0():System.String instance</code> | implemented | 1268 |
| method | <code>System.String::ToString``0():System.String instance</code> | implemented | 1255 |
| method | <code>System.String::ToString``0(System.IFormatProvider):System.String instance</code> | missing | — |
| method | <code>System.String::ToUpper``0():System.String instance</code> | implemented | 1269 |
| method | <code>System.String::ToUpper``0(System.Globalization.CultureInfo):System.String instance</code> | missing | — |
| method | <code>System.String::ToUpperInvariant``0():System.String instance</code> | implemented | 1267 |
| method | <code>System.String::Trim``0():System.String instance</code> | implemented | 1264 |
| method | <code>System.String::Trim``0(System.Char):System.String instance</code> | missing | — |
| method | <code>System.String::Trim``0(System.Char[]):System.String instance</code> | missing | — |
| method | <code>System.String::TrimEnd``0():System.String instance</code> | implemented | 1266 |
| method | <code>System.String::TrimEnd``0(System.Char):System.String instance</code> | missing | — |
| method | <code>System.String::TrimEnd``0(System.Char[]):System.String instance</code> | missing | — |
| method | <code>System.String::TrimStart``0():System.String instance</code> | implemented | 1265 |
| method | <code>System.String::TrimStart``0(System.Char):System.String instance</code> | missing | — |
| method | <code>System.String::TrimStart``0(System.Char[]):System.String instance</code> | missing | — |
| method | <code>System.String::TryCopyTo``0(System.Span`1&lt;System.Char&gt;):System.Boolean instance</code> | missing | — |
| field | <code>System.String::Empty:System.String static</code> | missing | — |
| property | <code>System.String::Chars[System.Int32]:System.Char get instance</code> | missing | — |
| property | <code>System.String::Length[]:System.Int32 get instance</code> | implemented | 1279 |

### Module <code>formatting</code>

Registered families: <code>format</code>.

| ABI ID | Registered signature | Registry status |
| --- | --- | --- |
| 1285 | <code>static object SharpForge.Runtime.Formatting::BoxValue(object, string)</code> | implemented |
| 1286 | <code>static string SharpForge.Runtime.Formatting::FormatValue(object, string, int, string)</code> | implemented |

No pinned reference inventory is included for these families; registered rows alone do not establish API coverage.

### Module <code>array</code>

Registered families: <code>array</code>.

| ABI ID | Registered signature | Registry status |
| --- | --- | --- |
| 1671 | <code>static void System.Array::Copy(int[], int[], int)</code> | implemented |
| 1672 | <code>static void System.Array::Copy(int[], int, int[], int, int)</code> | implemented |
| 1673 | <code>static void System.Array::Clear(int[], int, int)</code> | implemented |
| 1674 | <code>static void System.Array::Fill(int[], int)</code> | implemented |
| 1675 | <code>static void System.Array::Fill(int[], int, int, int)</code> | implemented |
| 1676 | <code>static int System.Array::IndexOf(int[], int)</code> | implemented |
| 1677 | <code>static int System.Array::LastIndexOf(int[], int)</code> | implemented |
| 1678 | <code>static int System.Array::BinarySearch(int[], int)</code> | implemented |
| 1679 | <code>static void System.Array::Copy(double[], double[], int)</code> | implemented |
| 1680 | <code>static void System.Array::Copy(double[], int, double[], int, int)</code> | implemented |
| 1681 | <code>static void System.Array::Clear(double[], int, int)</code> | implemented |
| 1682 | <code>static void System.Array::Fill(double[], double)</code> | implemented |
| 1683 | <code>static void System.Array::Fill(double[], double, int, int)</code> | implemented |
| 1684 | <code>static int System.Array::IndexOf(double[], double)</code> | implemented |
| 1685 | <code>static int System.Array::LastIndexOf(double[], double)</code> | implemented |
| 1686 | <code>static int System.Array::BinarySearch(double[], double)</code> | implemented |
| 1687 | <code>static void System.Array::Copy(bool[], bool[], int)</code> | implemented |
| 1688 | <code>static void System.Array::Copy(bool[], int, bool[], int, int)</code> | implemented |
| 1689 | <code>static void System.Array::Clear(bool[], int, int)</code> | implemented |
| 1690 | <code>static void System.Array::Fill(bool[], bool)</code> | implemented |
| 1691 | <code>static void System.Array::Fill(bool[], bool, int, int)</code> | implemented |
| 1692 | <code>static int System.Array::IndexOf(bool[], bool)</code> | implemented |
| 1693 | <code>static int System.Array::LastIndexOf(bool[], bool)</code> | implemented |
| 1694 | <code>static int System.Array::BinarySearch(bool[], bool)</code> | implemented |
| 1695 | <code>static void System.Array::Copy(string[], string[], int)</code> | implemented |
| 1696 | <code>static void System.Array::Copy(string[], int, string[], int, int)</code> | implemented |
| 1697 | <code>static void System.Array::Clear(string[], int, int)</code> | implemented |
| 1698 | <code>static void System.Array::Fill(string[], string)</code> | implemented |
| 1699 | <code>static void System.Array::Fill(string[], string, int, int)</code> | implemented |
| 1700 | <code>static int System.Array::IndexOf(string[], string)</code> | implemented |
| 1701 | <code>static int System.Array::LastIndexOf(string[], string)</code> | implemented |
| 1702 | <code>static int System.Array::BinarySearch(string[], string)</code> | implemented |
| 1703 | <code>static void System.Array::Copy(object[], object[], int)</code> | implemented |
| 1704 | <code>static void System.Array::Copy(object[], int, object[], int, int)</code> | implemented |
| 1705 | <code>static void System.Array::Clear(object[], int, int)</code> | implemented |
| 1706 | <code>static void System.Array::Fill(object[], object)</code> | implemented |
| 1707 | <code>static void System.Array::Fill(object[], object, int, int)</code> | implemented |
| 1708 | <code>static int System.Array::IndexOf(object[], object)</code> | implemented |
| 1709 | <code>static int System.Array::LastIndexOf(object[], object)</code> | implemented |
| 1710 | <code>static int System.Array::BinarySearch(object[], object)</code> | implemented |
| 524296 | <code>static int System.Array::BinarySearch(System.Array, object, System.Collections.IComparer)</code> | implemented |

Pinned reference: 2 implemented and 115 missing exact metadata rows.

| Reference kind | Exact reference signature | Status | Matching ABI IDs |
| --- | --- | --- | --- |
| type | <code>System.Array</code> | implemented | — |
| method | <code>System.Array::get_IsFixedSize``0():System.Boolean instance</code> | missing | — |
| method | <code>System.Array::get_IsReadOnly``0():System.Boolean instance</code> | missing | — |
| method | <code>System.Array::get_IsSynchronized``0():System.Boolean instance</code> | missing | — |
| method | <code>System.Array::get_Length``0():System.Int32 instance</code> | missing | — |
| method | <code>System.Array::get_LongLength``0():System.Int64 instance</code> | missing | — |
| method | <code>System.Array::get_MaxLength``0():System.Int32 static</code> | missing | — |
| method | <code>System.Array::get_Rank``0():System.Int32 instance</code> | missing | — |
| method | <code>System.Array::get_SyncRoot``0():System.Object instance</code> | missing | — |
| method | <code>System.Array::AsReadOnly``1(!!0[]):System.Collections.ObjectModel.ReadOnlyCollection`1&lt;!!0&gt; static</code> | missing | — |
| method | <code>System.Array::BinarySearch``0(System.Array,System.Int32,System.Int32,System.Object):System.Int32 static</code> | missing | — |
| method | <code>System.Array::BinarySearch``0(System.Array,System.Int32,System.Int32,System.Object,System.Collections.IComparer):System.Int32 static</code> | missing | — |
| method | <code>System.Array::BinarySearch``0(System.Array,System.Object):System.Int32 static</code> | missing | — |
| method | <code>System.Array::BinarySearch``0(System.Array,System.Object,System.Collections.IComparer):System.Int32 static</code> | implemented | 524296 |
| method | <code>System.Array::BinarySearch``1(!!0[],System.Int32,System.Int32,!!0):System.Int32 static</code> | missing | — |
| method | <code>System.Array::BinarySearch``1(!!0[],System.Int32,System.Int32,!!0,System.Collections.Generic.IComparer`1&lt;!!0&gt;):System.Int32 static</code> | missing | — |
| method | <code>System.Array::BinarySearch``1(!!0[],!!0):System.Int32 static</code> | missing | — |
| method | <code>System.Array::BinarySearch``1(!!0[],!!0,System.Collections.Generic.IComparer`1&lt;!!0&gt;):System.Int32 static</code> | missing | — |
| method | <code>System.Array::Clear``0(System.Array):System.Void static</code> | missing | — |
| method | <code>System.Array::Clear``0(System.Array,System.Int32,System.Int32):System.Void static</code> | missing | — |
| method | <code>System.Array::Clone``0():System.Object instance</code> | missing | — |
| method | <code>System.Array::ConstrainedCopy``0(System.Array,System.Int32,System.Array,System.Int32,System.Int32):System.Void static</code> | missing | — |
| method | <code>System.Array::ConvertAll``2(!!0[],System.Converter`2&lt;!!0,!!1&gt;):!!1[] static</code> | missing | — |
| method | <code>System.Array::Copy``0(System.Array,System.Array,System.Int32):System.Void static</code> | missing | — |
| method | <code>System.Array::Copy``0(System.Array,System.Array,System.Int64):System.Void static</code> | missing | — |
| method | <code>System.Array::Copy``0(System.Array,System.Int32,System.Array,System.Int32,System.Int32):System.Void static</code> | missing | — |
| method | <code>System.Array::Copy``0(System.Array,System.Int64,System.Array,System.Int64,System.Int64):System.Void static</code> | missing | — |
| method | <code>System.Array::CopyTo``0(System.Array,System.Int32):System.Void instance</code> | missing | — |
| method | <code>System.Array::CopyTo``0(System.Array,System.Int64):System.Void instance</code> | missing | — |
| method | <code>System.Array::CreateInstance``0(System.Type,System.Int32):System.Array static</code> | missing | — |
| method | <code>System.Array::CreateInstance``0(System.Type,System.Int32,System.Int32):System.Array static</code> | missing | — |
| method | <code>System.Array::CreateInstance``0(System.Type,System.Int32,System.Int32,System.Int32):System.Array static</code> | missing | — |
| method | <code>System.Array::CreateInstance``0(System.Type,System.Int32[]):System.Array static</code> | missing | — |
| method | <code>System.Array::CreateInstance``0(System.Type,System.Int32[],System.Int32[]):System.Array static</code> | missing | — |
| method | <code>System.Array::CreateInstance``0(System.Type,System.Int64[]):System.Array static</code> | missing | — |
| method | <code>System.Array::CreateInstanceFromArrayType``0(System.Type,System.Int32):System.Array static</code> | missing | — |
| method | <code>System.Array::CreateInstanceFromArrayType``0(System.Type,System.Int32[]):System.Array static</code> | missing | — |
| method | <code>System.Array::CreateInstanceFromArrayType``0(System.Type,System.Int32[],System.Int32[]):System.Array static</code> | missing | — |
| method | <code>System.Array::Empty``1():!!0[] static</code> | missing | — |
| method | <code>System.Array::Exists``1(!!0[],System.Predicate`1&lt;!!0&gt;):System.Boolean static</code> | missing | — |
| method | <code>System.Array::Fill``1(!!0[],!!0):System.Void static</code> | missing | — |
| method | <code>System.Array::Fill``1(!!0[],!!0,System.Int32,System.Int32):System.Void static</code> | missing | — |
| method | <code>System.Array::FindAll``1(!!0[],System.Predicate`1&lt;!!0&gt;):!!0[] static</code> | missing | — |
| method | <code>System.Array::FindIndex``1(!!0[],System.Int32,System.Int32,System.Predicate`1&lt;!!0&gt;):System.Int32 static</code> | missing | — |
| method | <code>System.Array::FindIndex``1(!!0[],System.Int32,System.Predicate`1&lt;!!0&gt;):System.Int32 static</code> | missing | — |
| method | <code>System.Array::FindIndex``1(!!0[],System.Predicate`1&lt;!!0&gt;):System.Int32 static</code> | missing | — |
| method | <code>System.Array::FindLastIndex``1(!!0[],System.Int32,System.Int32,System.Predicate`1&lt;!!0&gt;):System.Int32 static</code> | missing | — |
| method | <code>System.Array::FindLastIndex``1(!!0[],System.Int32,System.Predicate`1&lt;!!0&gt;):System.Int32 static</code> | missing | — |
| method | <code>System.Array::FindLastIndex``1(!!0[],System.Predicate`1&lt;!!0&gt;):System.Int32 static</code> | missing | — |
| method | <code>System.Array::FindLast``1(!!0[],System.Predicate`1&lt;!!0&gt;):!!0 static</code> | missing | — |
| method | <code>System.Array::Find``1(!!0[],System.Predicate`1&lt;!!0&gt;):!!0 static</code> | missing | — |
| method | <code>System.Array::ForEach``1(!!0[],System.Action`1&lt;!!0&gt;):System.Void static</code> | missing | — |
| method | <code>System.Array::GetEnumerator``0():System.Collections.IEnumerator instance</code> | missing | — |
| method | <code>System.Array::GetLength``0(System.Int32):System.Int32 instance</code> | missing | — |
| method | <code>System.Array::GetLongLength``0(System.Int32):System.Int64 instance</code> | missing | — |
| method | <code>System.Array::GetLowerBound``0(System.Int32):System.Int32 instance</code> | missing | — |
| method | <code>System.Array::GetUpperBound``0(System.Int32):System.Int32 instance</code> | missing | — |
| method | <code>System.Array::GetValue``0(System.Int32):System.Object instance</code> | missing | — |
| method | <code>System.Array::GetValue``0(System.Int32,System.Int32):System.Object instance</code> | missing | — |
| method | <code>System.Array::GetValue``0(System.Int32,System.Int32,System.Int32):System.Object instance</code> | missing | — |
| method | <code>System.Array::GetValue``0(System.Int32[]):System.Object instance</code> | missing | — |
| method | <code>System.Array::GetValue``0(System.Int64):System.Object instance</code> | missing | — |
| method | <code>System.Array::GetValue``0(System.Int64,System.Int64):System.Object instance</code> | missing | — |
| method | <code>System.Array::GetValue``0(System.Int64,System.Int64,System.Int64):System.Object instance</code> | missing | — |
| method | <code>System.Array::GetValue``0(System.Int64[]):System.Object instance</code> | missing | — |
| method | <code>System.Array::IndexOf``0(System.Array,System.Object):System.Int32 static</code> | missing | — |
| method | <code>System.Array::IndexOf``0(System.Array,System.Object,System.Int32):System.Int32 static</code> | missing | — |
| method | <code>System.Array::IndexOf``0(System.Array,System.Object,System.Int32,System.Int32):System.Int32 static</code> | missing | — |
| method | <code>System.Array::IndexOf``1(!!0[],!!0):System.Int32 static</code> | missing | — |
| method | <code>System.Array::IndexOf``1(!!0[],!!0,System.Int32):System.Int32 static</code> | missing | — |
| method | <code>System.Array::IndexOf``1(!!0[],!!0,System.Int32,System.Int32):System.Int32 static</code> | missing | — |
| method | <code>System.Array::Initialize``0():System.Void instance</code> | missing | — |
| method | <code>System.Array::LastIndexOf``0(System.Array,System.Object):System.Int32 static</code> | missing | — |
| method | <code>System.Array::LastIndexOf``0(System.Array,System.Object,System.Int32):System.Int32 static</code> | missing | — |
| method | <code>System.Array::LastIndexOf``0(System.Array,System.Object,System.Int32,System.Int32):System.Int32 static</code> | missing | — |
| method | <code>System.Array::LastIndexOf``1(!!0[],!!0):System.Int32 static</code> | missing | — |
| method | <code>System.Array::LastIndexOf``1(!!0[],!!0,System.Int32):System.Int32 static</code> | missing | — |
| method | <code>System.Array::LastIndexOf``1(!!0[],!!0,System.Int32,System.Int32):System.Int32 static</code> | missing | — |
| method | <code>System.Array::Resize``1(!!0[]&amp;,System.Int32):System.Void static</code> | missing | — |
| method | <code>System.Array::Reverse``0(System.Array):System.Void static</code> | missing | — |
| method | <code>System.Array::Reverse``0(System.Array,System.Int32,System.Int32):System.Void static</code> | missing | — |
| method | <code>System.Array::Reverse``1(!!0[]):System.Void static</code> | missing | — |
| method | <code>System.Array::Reverse``1(!!0[],System.Int32,System.Int32):System.Void static</code> | missing | — |
| method | <code>System.Array::SetValue``0(System.Object,System.Int32):System.Void instance</code> | missing | — |
| method | <code>System.Array::SetValue``0(System.Object,System.Int32,System.Int32):System.Void instance</code> | missing | — |
| method | <code>System.Array::SetValue``0(System.Object,System.Int32,System.Int32,System.Int32):System.Void instance</code> | missing | — |
| method | <code>System.Array::SetValue``0(System.Object,System.Int32[]):System.Void instance</code> | missing | — |
| method | <code>System.Array::SetValue``0(System.Object,System.Int64):System.Void instance</code> | missing | — |
| method | <code>System.Array::SetValue``0(System.Object,System.Int64,System.Int64):System.Void instance</code> | missing | — |
| method | <code>System.Array::SetValue``0(System.Object,System.Int64,System.Int64,System.Int64):System.Void instance</code> | missing | — |
| method | <code>System.Array::SetValue``0(System.Object,System.Int64[]):System.Void instance</code> | missing | — |
| method | <code>System.Array::Sort``0(System.Array):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``0(System.Array,System.Array):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``0(System.Array,System.Array,System.Collections.IComparer):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``0(System.Array,System.Array,System.Int32,System.Int32):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``0(System.Array,System.Array,System.Int32,System.Int32,System.Collections.IComparer):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``0(System.Array,System.Collections.IComparer):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``0(System.Array,System.Int32,System.Int32):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``0(System.Array,System.Int32,System.Int32,System.Collections.IComparer):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``1(!!0[]):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``1(!!0[],System.Collections.Generic.IComparer`1&lt;!!0&gt;):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``1(!!0[],System.Comparison`1&lt;!!0&gt;):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``1(!!0[],System.Int32,System.Int32):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``1(!!0[],System.Int32,System.Int32,System.Collections.Generic.IComparer`1&lt;!!0&gt;):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``2(!!0[],!!1[]):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``2(!!0[],!!1[],System.Collections.Generic.IComparer`1&lt;!!0&gt;):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``2(!!0[],!!1[],System.Int32,System.Int32):System.Void static</code> | missing | — |
| method | <code>System.Array::Sort``2(!!0[],!!1[],System.Int32,System.Int32,System.Collections.Generic.IComparer`1&lt;!!0&gt;):System.Void static</code> | missing | — |
| method | <code>System.Array::TrueForAll``1(!!0[],System.Predicate`1&lt;!!0&gt;):System.Boolean static</code> | missing | — |
| property | <code>System.Array::IsFixedSize[]:System.Boolean get instance</code> | missing | — |
| property | <code>System.Array::IsReadOnly[]:System.Boolean get instance</code> | missing | — |
| property | <code>System.Array::IsSynchronized[]:System.Boolean get instance</code> | missing | — |
| property | <code>System.Array::Length[]:System.Int32 get instance</code> | missing | — |
| property | <code>System.Array::LongLength[]:System.Int64 get instance</code> | missing | — |
| property | <code>System.Array::MaxLength[]:System.Int32 get static</code> | missing | — |
| property | <code>System.Array::Rank[]:System.Int32 get instance</code> | missing | — |
| property | <code>System.Array::SyncRoot[]:System.Object get instance</code> | missing | — |

### Module <code>random</code>

Registered families: <code>random</code>.

| ABI ID | Registered signature | Registry status |
| --- | --- | --- |
| 1711 | <code>System.Random System.Random::.ctor()</code> | implemented |
| 1712 | <code>System.Random System.Random::.ctor(int)</code> | implemented |
| 1713 | <code>static System.Random System.Random::get_Shared()</code> | implemented |
| 1714 | <code>int System.Random::Next()</code> | implemented |
| 1715 | <code>int System.Random::Next(int)</code> | implemented |
| 1716 | <code>int System.Random::Next(int, int)</code> | implemented |
| 1717 | <code>double System.Random::NextDouble()</code> | implemented |

Pinned reference: 9 implemented and 14 missing exact metadata rows.

| Reference kind | Exact reference signature | Status | Matching ABI IDs |
| --- | --- | --- | --- |
| type | <code>System.Random</code> | implemented | — |
| method | <code>System.Random::.ctor``0():System.Void instance</code> | implemented | 1711 |
| method | <code>System.Random::.ctor``0(System.Int32):System.Void instance</code> | implemented | 1712 |
| method | <code>System.Random::get_Shared``0():System.Random static</code> | implemented | 1713 |
| method | <code>System.Random::GetHexString``0(System.Int32,System.Boolean):System.String instance</code> | missing | — |
| method | <code>System.Random::GetHexString``0(System.Span`1&lt;System.Char&gt;,System.Boolean):System.Void instance</code> | missing | — |
| method | <code>System.Random::GetItems``1(System.ReadOnlySpan`1&lt;!!0&gt;,System.Int32):!!0[] instance</code> | missing | — |
| method | <code>System.Random::GetItems``1(System.ReadOnlySpan`1&lt;!!0&gt;,System.Span`1&lt;!!0&gt;):System.Void instance</code> | missing | — |
| method | <code>System.Random::GetItems``1(!!0[],System.Int32):!!0[] instance</code> | missing | — |
| method | <code>System.Random::GetString``0(System.ReadOnlySpan`1&lt;System.Char&gt;,System.Int32):System.String instance</code> | missing | — |
| method | <code>System.Random::Next``0():System.Int32 instance</code> | implemented | 1714 |
| method | <code>System.Random::Next``0(System.Int32):System.Int32 instance</code> | implemented | 1715 |
| method | <code>System.Random::Next``0(System.Int32,System.Int32):System.Int32 instance</code> | implemented | 1716 |
| method | <code>System.Random::NextBytes``0(System.Byte[]):System.Void instance</code> | missing | — |
| method | <code>System.Random::NextBytes``0(System.Span`1&lt;System.Byte&gt;):System.Void instance</code> | missing | — |
| method | <code>System.Random::NextDouble``0():System.Double instance</code> | implemented | 1717 |
| method | <code>System.Random::NextInt64``0():System.Int64 instance</code> | missing | — |
| method | <code>System.Random::NextInt64``0(System.Int64):System.Int64 instance</code> | missing | — |
| method | <code>System.Random::NextInt64``0(System.Int64,System.Int64):System.Int64 instance</code> | missing | — |
| method | <code>System.Random::NextSingle``0():System.Single instance</code> | missing | — |
| method | <code>System.Random::Shuffle``1(System.Span`1&lt;!!0&gt;):System.Void instance</code> | missing | — |
| method | <code>System.Random::Shuffle``1(!!0[]):System.Void instance</code> | missing | — |
| property | <code>System.Random::Shared[]:System.Random get static</code> | implemented | 1713 |

### Module <code>environment</code>

Registered families: <code>environment</code>.

| ABI ID | Registered signature | Registry status |
| --- | --- | --- |
| 524289 | <code>static string System.Environment::GetEnvironmentVariable(string)</code> | implemented |

No pinned reference inventory is included for these families; registered rows alone do not establish API coverage.

### Module <code>stringComparer</code>

Registered families: <code>stringComparer</code>, <code>orderingComparer</code>.

| ABI ID | Registered signature | Registry status |
| --- | --- | --- |
| 524290 | <code>int System.Collections.Generic.IComparer`1&lt;string&gt;::Compare(string, string)</code> | implemented |
| 524291 | <code>int System.Collections.Generic.IComparer`1&lt;object&gt;::Compare(object, object)</code> | implemented |
| 524292 | <code>static System.StringComparer System.StringComparer::get_Ordinal()</code> | implemented |
| 524293 | <code>int System.StringComparer::Compare(string, string)</code> | implemented |
| 524295 | <code>int System.StringComparer::Compare(object, object)</code> | implemented |
| 524297 | <code>static System.StringComparer System.StringComparer::get_OrdinalIgnoreCase()</code> | implemented |
| 524322 | <code>static System.StringComparer System.StringComparer::FromComparison(System.StringComparison)</code> | implemented |
| 524329 | <code>bool System.StringComparer::Equals(string, string)</code> | implemented |

No pinned reference inventory is included for these families; registered rows alone do not establish API coverage.

### Module <code>objectComparer</code>

Registered families: <code>objectComparer</code>.

| ABI ID | Registered signature | Registry status |
| --- | --- | --- |
| 524294 | <code>int System.Collections.IComparer::Compare(object, object)</code> | implemented |

No pinned reference inventory is included for these families; registered rows alone do not establish API coverage.

### Module <code>stopwatch</code>

Registered families: <code>stopwatch</code>.

| ABI ID | Registered signature | Registry status |
| --- | --- | --- |
| 524354 | <code>System.Diagnostics.Stopwatch System.Diagnostics.Stopwatch::.ctor()</code> | implemented |
| 524355 | <code>static System.Diagnostics.Stopwatch System.Diagnostics.Stopwatch::StartNew()</code> | implemented |
| 524356 | <code>void System.Diagnostics.Stopwatch::Start()</code> | implemented |
| 524357 | <code>void System.Diagnostics.Stopwatch::Stop()</code> | implemented |
| 524358 | <code>void System.Diagnostics.Stopwatch::Reset()</code> | implemented |
| 524359 | <code>void System.Diagnostics.Stopwatch::Restart()</code> | implemented |
| 524360 | <code>bool System.Diagnostics.Stopwatch::get_IsRunning()</code> | implemented |
| 524361 | <code>System.TimeSpan System.Diagnostics.Stopwatch::get_Elapsed()</code> | implemented |
| 524362 | <code>long System.Diagnostics.Stopwatch::get_ElapsedMilliseconds()</code> | implemented |
| 524363 | <code>long System.Diagnostics.Stopwatch::get_ElapsedTicks()</code> | implemented |
| 524364 | <code>static long System.Diagnostics.Stopwatch::GetTimestamp()</code> | implemented |
| 524365 | <code>static System.TimeSpan System.Diagnostics.Stopwatch::GetElapsedTime(long)</code> | implemented |
| 524366 | <code>static System.TimeSpan System.Diagnostics.Stopwatch::GetElapsedTime(long, long)</code> | implemented |
| 524367 | <code>string System.Diagnostics.Stopwatch::ToString()</code> | implemented |

No pinned reference inventory is included for these families; registered rows alone do not establish API coverage.

### Module <code>boolean</code>

Registered families: <code>boolean</code>.

| ABI ID | Registered signature | Registry status |
| --- | --- | --- |
| — | No registered members | — |

No pinned reference inventory is included for these families; registered rows alone do not establish API coverage.

<!-- bcl-module-inventory:end -->
