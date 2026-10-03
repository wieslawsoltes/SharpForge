# C# language, BCL, SIMD, workers and networking — SharpForge 0.14.0

This release extends the verified 0.13 source. It is a managed/browser compatibility profile, not an implementation of every feature of the latest C# language, the complete BCL, native CLR, or OS networking. There are 25 independently packaged modules, 44 docking tools, 68 Studio examples (67 runnable plus one intentional diagnostic), and eight new disk/ZIP examples. The existing code designer, Hot Reload, debugger, modal editors and WinUI host remain present.

## Language version and supported additions

Microsoft identifies C# 14 as the latest release and C# 15 as preview at the review date 2026-10-03. Official source references: [C# 14](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) and [C# 15](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15). These sources describe Microsoft's compiler; the following table describes this implementation.

| Feature | Implemented profile | Gate |
|---|---|---|
| Target-typed `new()` | Supported contexts in locals, fields, returns, arguments, conditionals and object initializers; existing known constructors | 9+ |
| Collection expressions | Supported arrays and closed List/HashSet contracts, literals and spread enumeration with cleanup | 12+ |
| Escape `\e` | Character/string escape for ESC | Parser support; historical mode gate not enforced |
| Field-backed properties | Contextual `field`, mixed semicolon/body accessors, initializer, escaped `@field`, real backing field/accessor emission | 14+ |
| Null-conditional assignment | Supported assignment statements to members/indexers, simple and compound; evaluate receiver once, skip indices and RHS on null | 14+ |
| Collection expression arguments | Leading `with(capacity: expression)` for supported List/HashSet targets | preview |
| Labeled break/continue | Named enclosing loops or switch (break); cleanup across nested regions retained | preview |

`langVersion:'14'` is the browser default. `latest`, `latestmajor` and `default` select 14; `preview` enables the two selected preview additions. Numeric 15 is rejected until it becomes a supported stable profile. Historical values 1–14 are accepted for these feature gates, not a claim that all historical restrictions and syntax are implemented. The parser/compiler rejects unsupported shapes instead of executing guessed semantics. Null-conditional assignment does not implement all general null-conditional expression/chaining behavior. Capacity arguments do not implement arbitrary comparer/factory argument overloads. Other C# 14 features such as extension blocks, first-class spans, user compound operators and partial events/constructors remain outside this update; C# 15 unions, closed hierarchies, extension indexers and memory-safety pointer rules are not implemented. General user-defined generics, complete inheritance/interfaces, ref structs, broad LINQ and arbitrary native framework linkage also remain incomplete.

`<LangVersion>preview</LangVersion>` is evaluated per project, including source-combined project references. A shared linked source with conflicting language configurations is rejected. CLI `--lang-version preview` applies to loose source; project XML remains authoritative. ZIP/recovery stores the chosen language version, never network grants. Source-VM, canonical-CIL reload, direct-CIL and exported/reassembled-IL tests execute the added language cases.

```csharp
class Meter {
    public int Value { get; set => field = value < 0 ? 0 : value; } = 2;
}
class Program {
    static void Main() {
        Meter meter = new();
        meter?.Value = 42;
        Console.WriteLine(meter.Value);
    }
}
```

The new `CsharpPreviewCollections` project contains capacity expressions and labeled loops with its own explicit preview configuration.

## BCL additions and storage

The exact registered members and overloads are generated in [runtime API inventory](runtime14-api.md); the full inherited registry is in [framework API inventory](winui-api.md). Names alone do not imply native .NET equivalence.

Array helpers support documented int/double/bool/string/object arrays: overlap-correct Copy, Clear, Fill, IndexOf, LastIndexOf and bounded BinarySearch. Ranges and types are validated before mutating any destination. Array writes notify the existing data-breakpoint/GC system.

Random supports an explicit seed, Next overloads, NextDouble and Shared. Seeded state uses the classic subtractive algorithm and is owned by the managed heap; reverse snapshots reproduce its results. It is not cryptographically secure, and no promise is made that default/unseeded behavior matches every .NET release.

System.Text.Json contracts include JsonDocument, JsonElement, JsonProperty, JsonValueKind, array/property enumeration and JsonSerializer.Serialize for supported primitives, arrays and registered collection values. JSON text, nodes and nesting are bounded (1,000,000 characters, 100,000 nodes, depth 128). Raw text spans and duplicate property order are preserved; property lookup uses the last duplicate. Disposal invalidates dependent element access, retained elements keep their owner alive, and cache identity changes with heap restore. Cycles, unsupported POCOs, nonfinite serializer numbers and limit violations fail explicitly. There is no reflection-based object serializer, Deserialize<T>, converter pipeline or full options contract.

Existing closed List/Dictionary/HashSet/Queue/Stack and StringBuilder APIs remain. This release adds cached canonical ABI/type dispatch and property slots, incremental dictionary/set lookup maps, a Queue ring buffer and in-place updates to existing heap slots. Appending data retains heap-capacity checks; snapshots own copies and restored record identity invalidates caches. The collector remains nonmoving, non-generational mark-and-sweep; host worker state is not a new concurrent GC.

## Real SIMD and isolated parallel compute

`@sharpforge/compute` contains authored C source, checked-in WASM and scalar kernels. It performs actual WebAssembly SIMD128 numerical operations. Managed `System.Numerics.Vector<int>` has four lanes and `Vector<double>` two; supported constructors, indexer, CopyTo, Zero/One/Count, arithmetic, equality, dot and sum lower through registered contracts. Int32Array/Float64Array bulk operations are also independently callable from JavaScript. Float32, Vector128/256/512 intrinsic families and arbitrary SIMD user types are not implemented. IsHardwareAccelerated identifies selected WASM capability, not audited native instruction lowering.

```csharp
using System.Numerics;
var a = new Vector<int>(new int[] {1, 2, 3, 4});
var b = new Vector<int>(2);
Console.WriteLine(Vector.Sum(a * b)); // 20
```

SIMD data copies into bounded linear memory and output copies back. Scalar fallback uses the same lane-order reductions and tested floating-point edge handling. It is not a managed heap JIT or GPU shader. Backend/bytes/call counts are visible in Language & Runtime; `auto`, `wasm`, `scalar` can be selected for the next launch.

`SharpForge.Runtime.ParallelMath` exposes supported SumAsync, DotAsync, AddAsync and MultiplyAsync operations on double arrays. They submit closed kernels to actual Node worker_threads/browser Blob workers and await through existing Task continuations. Two workers can execute independently while the VM waits. Managed inputs are owned snapshots, not shared references. Returned arrays are copied into managed storage; GC roots are held through completion. Existing C# Thread, Task and async stacks remain cooperative logical contexts; this is NOT arbitrary C# OS-thread execution, shared managed heap/locks/atomics, Parallel.For or multithreaded GC.

```csharp
using SharpForge.Runtime;
using System.Threading.Tasks;
class Program {
    static async Task Main() {
        double result = await ParallelMath.SumAsync(new double[] {20.0, 22.0});
        Console.WriteLine(result);
    }
}
```

The pool supports 1–8 workers, limits queued jobs/input bytes, owns transferable inputs/outputs, and terminates/replaces canceled running workers. Deadlines are verified on returned results as well as timers. Default limits and exact JavaScript API are in [compute package README](../packages/compute/README.md). Costs include copying, worker startup and scheduling; small operations may be slower, and using more workers is not an unconditional speedup.

## Managed HTTP and standalone WebSocket transport

The new managed contracts include Uri, HttpClient, HttpRequestMessage/ResponseMessage, HttpMethod, HttpContent/StringContent, header collections, HttpStatusCode, CancellationToken/Source. They cover the registered GET/DELETE/POST/PUT/PATCH/Send overloads, BaseAddress, buffered string content, status checks, explicit headers, timeout, disposal and cancellation. They use actual Fetch, not simulated responses. No raw TCP/UDP sockets/listeners, TLS bypass, cookie jar, HttpClientHandler, streaming managed bodies, arbitrary proxy, DNS API or managed ClientWebSocket is provided.

`@sharpforge/network` independently offers HTTP plus real text/binary WebSocket clients with bounded queues and backpressure checks. WebSocket is JavaScript-only in this release. Browser WebSocket cookies remain browser-controlled; only HTTP Fetch can set credentials omit. Package API/security details are [documented here](../packages/network/README.md).

Networking is DENIED BY DEFAULT. Opening source, a ZIP or a sample does not grant it. An explicitly enabled host list must contain exact origins (scheme/host/port), not a URL path, credentials, query or wildcard. Allowing an origin grants paths on that origin. Defaults are 1 MiB request/response, 10-second deadline, four concurrent requests and 32 queued requests. HTTP excludes cookies and sensitive transport headers, blocks redirects rather than following an ungranted destination, streams into a bounded buffer, respects CORS/CSP/mixed-content, and supports cancellation before or during I/O. Output is not a security sandbox for trusted native MSBuild tasks.

### Local working example

From the source directory, in the first terminal:

```sh
node scripts/network-example-server.js
# Explicitly started example server: http://127.0.0.1:8787/data
```

In another terminal, CLI:

```sh
node apps/cli/main.js run examples/release14/NetworkHttpClient/NetworkHttpClient.slnx \
  --allow-origin http://127.0.0.1:8787
```

Or browser development host:

```sh
SHARPFORGE_CONNECT_ORIGINS=http://127.0.0.1:8787 npm start
```

Open the NetworkHttpClient example, then **Language & Runtime**. Enable networking and grant `http://127.0.0.1:8787`, Apply, Run. The environment variable is the SERVER's CSP permission; the IDE checkbox/origin is the MANAGED SESSION's permission. Both are required. Revoke stops the session and clears grants. Loading a new workspace/sample clears grants; exported ZIPs/recovery do not contain grants, authentication, cookies or arbitrary extension code. Standalone has the same managed policy, but surrounding browser/file-origin CSP may still block connections.

Native IDE host accepts repeat `--connect-origin` on `serve`, independently of `--trust-projects` and of the managed session checkbox. Static `dist/_headers` defaults to connect-src self; hosting administrators must add explicitly approved origins. We do not remove CORS or provide a bypass proxy. The local example is a fixed data/echo demo, not a network forwarding service.

## External operations, debugging and determinism

External promises are tracked outside serializable managed heap state with rooted arguments/tasks and monotonically increasing epochs. Pending external work blocks snapshots; completion changes the epoch. Reverse execution cannot cross a compute/network boundary into state that would repeat or undo host effects. New checkpoints after completion can be used normally. Existing earlier history is discarded/rebased with an explanation. Explicit function evaluation that could initiate external work is rejected; safe watches remain side-effect-free. Evaluation previews cannot initiate undoable I/O. Stop/restart cancels work, and late completions from old generations cannot overwrite new state. HTTP request/cancellation and runtime stop tests run against real local servers in both engines.

The clock does not fast-forward a real HTTP deadline while waiting for Task completion. GC root tests, forced collection while awaiting, stale completions, failed observers and snapshot barriers have regression coverage. This is not external-world time travel. The networking grant belongs to the trusted host, not the executing C# code.

## IDE and API controls

Language & Runtime is a new independent docking tool, available through Window and command search. It selects loose-source LangVersion, numerical backend and worker count, displays actual selected SIMD backend/worker identities/completions/pending work and networking policy, and exposes revoke/stop. Project LangVersion remains authoritative. Debugger status explains the external history barrier. Visual Studio remains the default editor mode; existing designer/source sync and all other panels remain.

Run `npm test`, `npm run check`, `npm run test:packages`; browser suite `CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser:runtime`; standalone `npm run standalone` then `npm run test:standalone`. See [validation](validation-0.14.0.md), [performance](performance-0.14.0.md), and [examples](../examples/release14/README.md).
