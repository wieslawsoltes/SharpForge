# Runtime additions API — 0.14.0

Generated from 24 registered runtime type contracts. Closed overloads only; this is not the complete .NET BCL. See language-runtime-networking.md for exact behavior, host grants and unsupported features. Enum/delegate/helper names can appear as parameter/result types without being classes.

## System.Uri

Kind: network; family: uri.

- `System.Uri .ctor(string)`
- `System.Uri .ctor(System.Uri, string)`
- `string get_OriginalString()`
- `string get_AbsoluteUri()`
- `string get_AbsolutePath()`
- `string get_Host()`
- `string get_Scheme()`
- `int get_Port()`
- `bool get_IsAbsoluteUri()`
- `string ToString()`
- `static string EscapeDataString(string)`
- `static string UnescapeDataString(string)`

## System.Net.Http.HttpClient

Kind: network; family: httpClient.

- `System.Net.Http.HttpClient .ctor()`
- `System.Uri get_BaseAddress()`
- `void set_BaseAddress(System.Uri)`
- `System.TimeSpan get_Timeout()`
- `void set_Timeout(System.TimeSpan)`
- `System.Net.Http.Headers.HttpRequestHeaders get_DefaultRequestHeaders()`
- `System.Threading.Tasks.Task`1<string> GetStringAsync(string)`
- `System.Threading.Tasks.Task`1<string> GetStringAsync(string, System.Threading.CancellationToken)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> GetAsync(string)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> GetAsync(string, System.Threading.CancellationToken)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> DeleteAsync(string)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> DeleteAsync(string, System.Threading.CancellationToken)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> PostAsync(string, System.Net.Http.HttpContent)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> PostAsync(string, System.Net.Http.HttpContent, System.Threading.CancellationToken)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> PutAsync(string, System.Net.Http.HttpContent)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> PutAsync(string, System.Net.Http.HttpContent, System.Threading.CancellationToken)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> PatchAsync(string, System.Net.Http.HttpContent)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> PatchAsync(string, System.Net.Http.HttpContent, System.Threading.CancellationToken)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> SendAsync(System.Net.Http.HttpRequestMessage)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> SendAsync(System.Net.Http.HttpRequestMessage, System.Threading.CancellationToken)`
- `void Dispose()`
- `void CancelPendingRequests()`

## System.Net.Http.HttpRequestMessage

Kind: network; family: httpRequest.

- `System.Net.Http.HttpRequestMessage .ctor()`
- `System.Net.Http.HttpRequestMessage .ctor(System.Net.Http.HttpMethod, string)`
- `System.Net.Http.HttpMethod get_Method()`
- `void set_Method(System.Net.Http.HttpMethod)`
- `System.Uri get_RequestUri()`
- `void set_RequestUri(System.Uri)`
- `System.Net.Http.HttpContent get_Content()`
- `void set_Content(System.Net.Http.HttpContent)`
- `System.Net.Http.Headers.HttpRequestHeaders get_Headers()`
- `void Dispose()`

## System.Net.Http.HttpResponseMessage

Kind: network; family: httpResponse.

- `System.Net.HttpStatusCode get_StatusCode()`
- `string get_ReasonPhrase()`
- `bool get_IsSuccessStatusCode()`
- `System.Net.Http.HttpContent get_Content()`
- `System.Net.Http.Headers.HttpResponseHeaders get_Headers()`
- `System.Net.Http.HttpResponseMessage EnsureSuccessStatusCode()`
- `void Dispose()`

## System.Net.Http.HttpMethod

Kind: network; family: httpMethod.

- `System.Net.Http.HttpMethod .ctor(string)`
- `static System.Net.Http.HttpMethod get_Get()`
- `static System.Net.Http.HttpMethod get_Post()`
- `static System.Net.Http.HttpMethod get_Put()`
- `static System.Net.Http.HttpMethod get_Delete()`
- `static System.Net.Http.HttpMethod get_Patch()`
- `static System.Net.Http.HttpMethod get_Head()`
- `static System.Net.Http.HttpMethod get_Options()`
- `string get_Method()`
- `string ToString()`

## System.Net.Http.HttpContent

Kind: network; family: httpContent.

- `System.Threading.Tasks.Task`1<string> ReadAsStringAsync()`
- `System.Net.Http.Headers.HttpContentHeaders get_Headers()`
- `void Dispose()`

## System.Net.Http.StringContent

Kind: network; family: httpContent.

- `System.Net.Http.StringContent .ctor(string)`

## System.Net.Http.Headers.HttpRequestHeaders

Kind: network; family: httpHeaders.

- `void Add(string, string)`
- `bool TryAddWithoutValidation(string, string)`
- `bool Remove(string)`
- `bool Contains(string)`
- `void Clear()`
- `string ToString()`

## System.Net.Http.Headers.HttpResponseHeaders

Kind: network; family: httpHeaders.

- `void Add(string, string)`
- `bool TryAddWithoutValidation(string, string)`
- `bool Remove(string)`
- `bool Contains(string)`
- `void Clear()`
- `string ToString()`

## System.Net.Http.Headers.HttpContentHeaders

Kind: network; family: httpHeaders.

- `void Add(string, string)`
- `bool TryAddWithoutValidation(string, string)`
- `bool Remove(string)`
- `bool Contains(string)`
- `void Clear()`
- `string ToString()`

## System.Threading.CancellationToken

Kind: network; family: cancellation.

- `bool get_IsCancellationRequested()`
- `bool get_CanBeCanceled()`
- `static System.Threading.CancellationToken get_None()`
- `void ThrowIfCancellationRequested()`

## System.Threading.CancellationTokenSource

Kind: network; family: cancellation.

- `System.Threading.CancellationTokenSource .ctor()`
- `System.Threading.CancellationToken get_Token()`
- `bool get_IsCancellationRequested()`
- `void Cancel()`
- `void Dispose()`

## System.Numerics.Vector

Kind: numeric; family: vectorStatic.

- `static bool get_IsHardwareAccelerated()`
- `static System.Numerics.Vector`1<int> Add(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static System.Numerics.Vector`1<int> Subtract(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static System.Numerics.Vector`1<int> Multiply(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static System.Numerics.Vector`1<int> Min(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static System.Numerics.Vector`1<int> Max(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static System.Numerics.Vector`1<int> BitwiseAnd(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static System.Numerics.Vector`1<int> Xor(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static int Dot(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static int Sum(System.Numerics.Vector`1<int>)`
- `static bool EqualsAll(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static bool EqualsAny(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static System.Numerics.Vector`1<double> Add(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static System.Numerics.Vector`1<double> Subtract(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static System.Numerics.Vector`1<double> Multiply(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static System.Numerics.Vector`1<double> Min(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static System.Numerics.Vector`1<double> Max(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static System.Numerics.Vector`1<double> Divide(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static double Dot(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static double Sum(System.Numerics.Vector`1<double>)`
- `static bool EqualsAll(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static bool EqualsAny(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`

## System.Numerics.Vector`1<int>

Kind: numeric; family: vector.

- `System.Numerics.Vector`1<int> .ctor(int)`
- `System.Numerics.Vector`1<int> .ctor(int[])`
- `System.Numerics.Vector`1<int> .ctor(int[], int)`
- `static int get_Count()`
- `static System.Numerics.Vector`1<int> get_Zero()`
- `static System.Numerics.Vector`1<int> get_One()`
- `int get_Item(int)`
- `void CopyTo(int[])`
- `void CopyTo(int[], int)`
- `bool Equals(System.Numerics.Vector`1<int>)`

## System.Numerics.Vector`1<double>

Kind: numeric; family: vector.

- `System.Numerics.Vector`1<double> .ctor(double)`
- `System.Numerics.Vector`1<double> .ctor(double[])`
- `System.Numerics.Vector`1<double> .ctor(double[], int)`
- `static int get_Count()`
- `static System.Numerics.Vector`1<double> get_Zero()`
- `static System.Numerics.Vector`1<double> get_One()`
- `double get_Item(int)`
- `void CopyTo(double[])`
- `void CopyTo(double[], int)`
- `bool Equals(System.Numerics.Vector`1<double>)`

## SharpForge.Runtime.ParallelMath

Kind: numeric; family: parallel.

- `static System.Threading.Tasks.Task`1<double> SumAsync(double[])`
- `static System.Threading.Tasks.Task`1<double> DotAsync(double[], double[])`
- `static System.Threading.Tasks.Task`1<double[]> AddAsync(double[], double[])`
- `static System.Threading.Tasks.Task`1<double[]> MultiplyAsync(double[], double[])`

## System.Array

Registered contracts and pinned reference status are maintained in [the BCL module inventory](bcl-api.md#registered-bcl-modules-and-pinned-reference-status).

## System.Random

Registered contracts and pinned reference status are maintained in [the BCL module inventory](bcl-api.md#registered-bcl-modules-and-pinned-reference-status).

## System.Text.Json.JsonDocument

Kind: bcl14; family: jsonDocument.

- `static System.Text.Json.JsonDocument Parse(string)`
- `System.Text.Json.JsonElement get_RootElement()`
- `void Dispose()`

## System.Text.Json.JsonElement

Kind: bcl14; family: jsonElement.

- `System.Text.Json.JsonValueKind get_ValueKind()`
- `System.Text.Json.JsonElement GetProperty(string)`
- `System.Text.Json.JsonElement get_Item(int)`
- `int GetArrayLength()`
- `string GetString()`
- `int GetInt32()`
- `double GetDouble()`
- `bool GetBoolean()`
- `string GetRawText()`
- `string ToString()`
- `System.Text.Json.JsonElement.ArrayEnumerator EnumerateArray()`
- `System.Text.Json.JsonElement.ObjectEnumerator EnumerateObject()`

## System.Text.Json.JsonProperty

Kind: bcl14; family: jsonProperty.

- `string get_Name()`
- `System.Text.Json.JsonElement get_Value()`

## System.Text.Json.JsonElement.ArrayEnumerator

Kind: bcl14; family: jsonEnumerator.

- `System.Text.Json.JsonElement.ArrayEnumerator GetEnumerator()`
- `bool MoveNext()`
- `void Dispose()`
- `System.Text.Json.JsonElement get_Current()`

## System.Text.Json.JsonElement.ObjectEnumerator

Kind: bcl14; family: jsonEnumerator.

- `System.Text.Json.JsonElement.ObjectEnumerator GetEnumerator()`
- `bool MoveNext()`
- `void Dispose()`
- `System.Text.Json.JsonProperty get_Current()`

## System.Text.Json.JsonSerializer

Kind: bcl14; family: jsonSerializer.

- `static string Serialize(object)`

Default string escaping is pinned to System.Text.Json on .NET 10.0.5, including
non-ASCII text, HTML-sensitive characters, dictionary keys and invalid UTF-16
surrogate replacement. Serialization retains its existing one-million UTF-16
unit output budget; escape expansion beyond that budget raises `JsonException`.
Binary64 numeric tokens use the shared invariant .NET formatter, preserving
negative zero, shortest round-trip digits and uppercase, padded exponents.
The .NET 10.0.5 numeric oracle covers fifty bit patterns through scalar, mixed
array and dictionary serialization in both JavaScript VMs. The existing
`JsonException` policy for nonfinite input is retained; native .NET reports
`ArgumentException`. Single/Decimal formatting remains unqualified.
The registered `Dictionary<int, T>` and `Dictionary<string, T>` profiles serialize
keys as property names in collection enumeration order, including numeric-looking
string keys. Declared boolean dictionary values and boxed Boolean/Char values
retain their JSON types. Dictionary traversal is shared with the collection
package so removed entries and reused slots follow its enumeration policy.
The source compiler still rejects `char` values with `SF2003`; boxed Char
serialization is qualified through independently assembled CIL.
Custom encoders and arbitrary object reflection are not supported.
