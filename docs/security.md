> **0.7 native build exception:** The browser VM restrictions below do not apply to the new local MSBuild host. Explicitly trusted native SDKs, property functions, imports, tasks, packages and analyzers execute with the host OS account. The loopback token/Origin/path checks protect the API, not execution of untrusted builds. Read [native MSBuild trust and limits](msbuild.md#trust-and-deployment-boundary) before enabling `--trust-projects`.

**0.8 update:** See [Explorer, menus, editor profiles and breakpoint workflows](explorer-keymaps.md) and [current validation](validation-0.8.0.md). Earlier feature sections below remain applicable within their stated limits.

# Security, resource limits and trust boundaries

SharpForge does not evaluate user programs as host JavaScript. The compiler emits its own instructions, and the runtime dispatches a fixed instruction/intrinsic set. Managed programs have no general DOM, filesystem, process-launch or raw host-object API. Networking is denied by default,
but managed `HttpClient` can access exact HTTP(S) origins explicitly granted by the embedding host or CLI `--allow-origin`.
The transport bounds requests/responses, queues and deadlines; browser CORS, mixed-content rules and administrator CSP
remain independent checks. A grant permits paths on that origin, not one endpoint, and is not DNS pinning or a native SSRF
firewall. JavaScript WebSocket support also requires exact WS(S) grants; browser cookies follow browser WebSocket rules.
See the [network contract](../packages/network/README.md). This is a useful architectural boundary, **not an audited sandbox or a promise that hostile source/bytecode cannot exploit an implementation defect**.

The browser UI is a trusted application. User-provided text is escaped in its HTML presentation. Bytecode images are structurally verified before VM creation, but the verifier is not a formal proof of type or memory safety. Never add a general host callback, eval escape hatch or arbitrary-property bridge without redesigning the trust model.

For the current boundary/test inventory and private disclosure route, see the [threat model](../planning/qualification/threat-model.md) and [security policy](../SECURITY.md).

## Default limits

| Resource | Default |
| --- | --- |
| Workspace documents | 100 |
| Single source snapshot | 2,000,000 UTF-16 code units |
| Workspace token interning cache | 32,768 entries |
| Parser nesting | 200 |
| Parser diagnostics | 200 per parse, with compiler diagnostic cap |
| Managed logical heap | 32 MiB, including each array's 32-byte record header and exact-width primitive payload |
| Array length | Derived from heap bytes and element width; an otherwise empty default heap admits 8,388,600 `int` elements |
| Managed stack | 4 MiB logical bytes; optional independent `maxFrames` ceiling |
| Execution | 20,000,000 instructions |
| Console output | 1,000,000 characters |
| Debugger history | 64 snapshots and approximately 8 MiB |
| Watch evaluation | 1,000 visited expression nodes |

Several limits can be lowered through constructor options. They do not account for all JavaScript allocations, retained source text, compiler metadata, editor histories or browser process memory. Direct low-level compiler consumers must supply their own source limits; the Workspace wraps these limits for normal IDE use.

Primitive arrays use typed backing: `int[n]` reserves `32 + 4*n` logical bytes,
while `byte[n]` reserves `32 + n`. Reference and aggregate array slots currently
use the logical eight-byte slot estimate plus the same header. A vector's length
ceiling is the minimum of `floor(max(0, maxBytes - 32) / elementBytes)`, the optional
`maxArrayLength` setting and the host addressing cap of `0xffffffff` elements.
Admission also checks the combined bytes of all reachable heap records after
collection; a length that fits an otherwise empty heap can still exhaust a
populated heap. The compiled program entry wrapper retains an empty `string[]`
argument vector, which consumes 32 bytes even when no arguments are supplied.
With that vector alive, a default guest can allocate at most 8,388,592 Int32
elements in one array. Materialized managed fault objects and their message
strings also consume heap bytes when space permits; allocation failure retains
its original fault if those diagnostic allocations cannot fit.
Oversized lengths or exhausted heap bytes produce managed
`OutOfMemoryException`; negative or non-integral lengths produce
`OverflowException`. There is no separate default one-million-element ceiling.

The [security limit tests](../tests/conformance/security/limits.test.js) cover the
exact default guest Int32-array byte boundary and one element over, a ninth
million-element Int32 array exhausting the heap while the first eight remain
reachable, and smaller
explicit byte/length limits in source and direct CIL execution. They also check
typed storage, admission before allocation and rooted survival after rejected
requests. Reports separate bootstrap bytes, guest array payload records and
managed fault records from the total peak. These are executable policy checks; their presence does not claim a
passing run on an unmeasured revision or platform.

The runtime's `maxBytes` option limits the managed heap. PE admission uses the
independent `assemblyLimits.maxBytes` option (64 MiB by default); a small heap
budget does not reject a larger assembly file. Structural decoding limits such
as `assemblyLimits.maxInstructions` are also separate from the runtime's
executed-instruction budget. An explicitly supplied `AssemblyInspector` retains
the decoding limits with which its host constructed it.

Instruction and stack-budget exhaustion are deliberately uncatchable runtime faults.
The [managed stack policy](default-managed-stack-budget.md) accounts active, parked
and callback frames while preserving explicit host depth limits. Other managed
faults may be caught, but the instruction limit still bounds repeated fault handling.
Time budgets are cooperative, not hard real-time deadlines. A builtin or collection
can exceed a slice duration. A production host should add a worker watchdog and
terminate/recreate a worker that becomes unresponsive. The preview's request timeout
reports failure but does not automatically repair a hung compiler worker.

## Persistence and deployment

Local storage is not durable backup and may be unavailable, full or cleared by the browser. Export project files regularly. Opening or importing a project replaces the current workspace after keeping a best-effort previous-project recovery copy. Do not rely on this preview for irreplaceable source without external backups.

The development server binds to localhost by default. Its static response headers and the generated `_headers` file are starting points for hosting, not a substitute for deployment review. Serve over HTTPS for a remote deployment; verify CSP, correct JavaScript MIME types, relative-path loading, browser storage policies and source limits on the actual origin.

Earlier validation used an in-memory browser loader when enterprise policy blocked URL navigation. Its storage substitute
was test-only; those results cannot qualify deployed HTTP/CSP or native storage. Current [browser qualification fixtures](../tests/conformance/browser/)
include actual navigation and file-origin checks. Their presence does not establish a passing run for a release or host:
retain the exact commit, artifact, engine/platform and results before claiming deployment coverage.

## Standalone HTML release

`SharpForge-standalone.html` embeds scripts/styles and starts self-contained Blob workers. It needs no external download
to start; explicitly granted network operations remain possible. Local opening depends on browser file-origin worker and
storage policy. The generated CSP permits the exact emitted inline entry-script hash and Blob workers; this does not grant
arbitrary inline JavaScript. A stricter hosting policy can block those features. Prefer the normal browser distribution for
a production static host; do not weaken a site's global CSP merely to embed this convenience artifact. CSP metadata cannot
enforce `frame-ancestors`; that directive needs an HTTP header. Neither CSP nor an embedded hash authenticates a distributor
able to replace both the HTML and its policy. No cross-browser file-origin qualification is claimed by this document.

## PE/CLI loading in 0.2

The browser loader accepts at most 64 MiB by default, uses bounded little-endian readers, validates metadata/token references and instruction boundaries, and allowlists external intrinsic calls. The file dialog checks the DLL size before reading it. The current `SharpForge.CIL/1` loader requires the mapping stream and verifies an exact canonical re-emission of the decoded program, including constructor scaffolding, signatures, metadata and IL spans. Noncanonical or unsupported assemblies fail before execution.

Canonical equality is **format validation, not authentication**. The deterministic MVID/build identifier is not a cryptographic integrity digest or signature. No trust or origin decision should be based on it. The profile verifier is neither a full ECMA-335 verifier nor a proof against implementation bugs. Whole-binary loading/verification allocates host memory beyond the VM managed-heap budget; enforce worker/process limits for hostile input. Do not execute emitted DLLs on a native .NET host as a sandboxing mechanism.

Embedded source is readable by anyone with the DLL. Use `embedSources:false`/`--no-sources` to omit source text; local names and profile maps still remain. `--native-only` strips the entire `#SF` stream, disables canonical source-debugger loading (the direct-CIL subset remains available) and does not establish signing or protection against decompilation. Keep the original imported DLL externally: project export/local recovery preserve editable source documents, not a durable copy of the imported executable.


## 0.3 additional boundaries

Ordinary DLL inspection does not run guest code. Direct CIL execution is explicit, limited to an allowlist and capped by method/frame/stack/instruction/output/heap budgets; it is not a complete CLR verifier or independently audited production sandbox. Run parsing/execution in workers and impose host wall-clock/message limits. Unsupported imports/native code are refused, not invoked. Edited IL invalidates signatures and source maps; no tampered binary is represented as still signed.

The extension driver accepts **trusted synchronous JavaScript callbacks**. Output budgets and cancellation checks do not prevent a hostile callback from blocking its host thread or accessing host APIs. Studio only selects built-ins. Do not treat this extension API as isolation for untrusted plugins. Refactoring edits validate versions/spans/candidate compilation before applying, but this is not a formal semantic-equivalence proof.

## 0.4 selected-disk and window boundaries

Folder imports read only user-selected records/handles. The XML reader rejects DTDs and external entities, limits characters/nodes/depth and never fetches imports from the network. Paths normalize within the selected root; absolute paths, URIs and root escapes are rejected. Directory enumeration is bounded and skips generated/dependency folders. Symlinks are not followed by the CLI directory reader. The CLI path checks are not an operating-system security sandbox against concurrent filesystem changes.

Project graphs may describe up to 100 projects; the compiler Workspace still limits the active source closure to 100 source documents. Directory reads cap files, entries, depth, individual file sizes and total bytes; see the project-system source for exact enforced bounds. Unsupported packages, binary references, analyzer DLLs and MSBuild tasks produce diagnostics rather than executing project-supplied code. Registered JavaScript extensions remain trusted host code.

Explicit disk saves compare opened source baselines, acquire permissions, then recheck all baselines before opening write streams. Permission denial/conflicts cause no writes during that preflight. Writes afterward are sequential, not multi-file atomic: a later I/O failure can leave a prefix saved; errors report completed paths. Concurrent changes after preflight remain a race. The preview does not write new/renamed project items back to disk automatically. File-input fallback supports reads and downloads, not in-place writes. Native permission prompts and real writable streams were not exercised in this environment; the preflight/error paths use unit mocks.

Dock layout imports validate registered IDs, unique placement, tree depth/count and finite dimensions, and roll back invalid snapshots. Same-origin popouts share the trusted application and move existing DOM nodes; they are not plugin or tenant isolation. They require the main window to remain open and may be blocked by browser popup policy. Named layouts use best-effort local storage, not cloud synchronization.
