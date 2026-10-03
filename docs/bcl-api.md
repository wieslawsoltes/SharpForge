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
