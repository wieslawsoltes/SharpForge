# @sharpforge/cil

Genuine ECMA-335 PE/CLI emission, typed CIL lowering, bounded metadata/IL loading, canonical-profile verification and disassembly. JavaScript ESM. Version 0.6.0. MIT. Sibling dependencies: `@sharpforge/bytecode` and `@sharpforge/framework`.

```js
import { emitAssembly, loadAssembly, formatAssembly } from '@sharpforge/cil';

// image is the successful internal output of @sharpforge/compiler.compile().
const dll = emitAssembly(image, { framework: 'net8', embedSources: true });
const executable = loadAssembly(dll); // load once, reuse with VirtualMachine
console.log(formatAssembly(dll));
```

`emitAssemblyDetailed(image, options)` additionally exposes emission metrics and debug mappings. `compileToIL()` in the compiler package combines frontend and backend. The runtime and debugger accept DLL byte arrays or a reused decoded module.

The DLL contains real metadata/signatures, CIL method bodies and exception tables—not embedded VM code. An additional `#SF` stream holds source/local mappings and IL-span boundaries. `embedSources:false` removes source text; `includeDebug:false` strips this stream; the canonical source loader cannot load it, but supported methods can run in the separate direct-CIL interpreter.

The browser loader supports the exact emitted `SharpForge.CIL/1` profile. It checks canonical re-emission and rejects arbitrary external/noncanonical DLLs; it is not a general CLR loader or audited sandbox. PE32 emission; PE32/PE32+ header reading; default net8 and alternative mscorlib4 reference identities. No full C# semantics, Portable PDBs, strong names, native/JIT code or full .NET BCL.

The root source release includes the complete backend contract, public API examples, measurements, regression suite, independent .NET execution test harness and compatibility boundaries. The packages are local tarballs, not registry-published.

0.6 emits actual checked arithmetic/conversion instructions and InterfaceImpl metadata for concrete IDisposable resources, alongside finally cleanup. The canonical loader reconstructs and verifies these supported forms.

## Registered external readonly fields

`resolveExecutionField` admits a closed field profile from
`frameworkType(owner).fields`. Admission requires a genuine field MemberRef with
an external top-level TypeRef owner, its exact registered owner/name/signature, and an
approved assembly scope. Field definitions and locally scoped references continue
to use ordinary local storage, including a local type with the same name.
Owner namespace and metadata name, and the field's primitive signature AST,
are checked independently of the inspector's display strings.

The approved identities are `System.Runtime` with public key token
`b03f5f7f11d50a3a` and `System.Private.CoreLib` with token
`7cec85d7bea7798e`, both with neutral culture. Each descriptor must include
`System.Runtime` for source emission and may additionally opt into CoreLib for
native CIL; registration rejects CoreLib-only profiles. Scope names, tokens,
and culture are matched exactly;
assembly versions are preserved but deliberately not compared, allowing facade
version compatibility. This policy does not admit arbitrary `System`, `mscorlib`,
unsigned, or similarly named assemblies. These are closed execution profiles,
not general external assembly loading or field providers.

The returned field retains its original token, owner, and signature, adds
`isStatic: true`/`isInitOnly: true`, and carries an immutable `externalField`
descriptor. `executionFieldAccessError(field, opcode)` returns a policy error
string or `null`; the admission verifier and runtime storage share this helper.
`ldsfld` loads the declared value. Instance access and writes are rejected.
`ldsflda` requires the descriptor's `addressable` opt-in, and indirect writes
remain rejected even when readable addresses are permitted. Existing Decimal
loads and readable managed addresses retain their prior behavior.

`compileToAssembly` binds these members as actual readonly fields and emits real
`ldsfld` instructions with field MemberRefs. The separate source-image route,
`compile`/`compileToIL`, substitutes fixed profile values after field binding;
its generated CIL contains scalar load instructions. Neither route marks the
symbol as a C# constant: const initializers and readonly writes retain language
diagnostics. Direct-CIL storage decodes each JSON scalar once per static slot,
and the initialized value participates in existing snapshot/restore behavior.

The focused regression files are `tests/a07-readonly-fields.test.js` and
`tests/a07-readonly-field-cil.test.js`. The baseline-compatible
`scripts/benchmarks/a07-readonly-field-loads.mjs` harness measures ordinary
static loads in both revisions and registered loads in the candidate; it reports
whole-loop timing, including VM execution overhead, rather than isolated opcode
or allocation cost. Copy the identical harness into `scripts/benchmarks/` in
each worktree and run each copy from its own worktree; fixed static imports use
that worktree's public packages. Pass `--mode baseline` or `--mode candidate`
and `--output /absolute/result.json` through `node scripts/limited.js node
scripts/benchmarks/a07-readonly-field-loads.mjs`. There is no `--workspace` option;
the report derives its workspace path from the script's location.

## Signature codecs

`decodeSignature(bytes)` and `decodeTypeSignature(bytes)` return lossless ASTs.
`encodeSignature(ast)` and `encodeTypeSignature(ast)` write those shapes without
resolving names. Named types preserve `class` versus `valuetype` and their metadata
tokens. Generic parameters retain type/method scope; modifiers retain nesting
order; arrays retain rank, sizes and signed lower bounds. Method signatures retain
calling convention, `hasThis`, `explicitThis`, generic arity and sentinel position.
Primitive nodes are immutable and shared to avoid repeated allocations.

`readSignature` and `readTypeSignature` retain the existing formatted inspection
API. Its strings intentionally omit some binary distinctions; use the AST for
round trips. `parseSignatureType(text, resolveToken)` adapts existing string-based
emission, including nested generics, byrefs, modifiers and bounded arrays. Use an
explicit AST or `valuetype Name` when a user-defined value type is not registered.
The optional third argument `{ namedTypes: Map<string, AST> }` resolves declared
names before parsing punctuation, including inside constructed types. The emitter
uses this for synthesized classes such as `<>Cell(int)` and `ValueTuple(int;string)`.
`readTypeSignature` accepts the historical standalone return-type forms (including
byrefs and void); `decodeTypeSignature` defaults to the stricter TypeSpec context.
`MetadataBuilder.typeSpec(ast)` interns TypeSpec rows by encoded bytes.

`encodeCustomAttribute(parameterTypes, values, namedArguments, options)` emits
ECMA-335 II.23.3 blobs. Types accept signature ASTs or primitive names; enums use
`{ kind: 'enum', name, underlying }`, arrays use `{ kind: 'szarray', element }`,
and boxed objects use `{ type, value }` (plain `null` encodes a null boxed string).
Named arguments are `{ name, isField, type, value }`. `System.Type` values are
serialized type-name strings or null. Integers outside JavaScript's safe range
require `BigInt`. A constructor token can replace `parameterTypes` when `options.metadata`
is supplied; external enum storage requires `options.enumUnderlyingType(name, token)`.
Unknown enums, invalid values, cancellation and size/depth limits produce coded
`CilError`s. The optional limits are `maxBytes`, `maxStringBytes`, `maxArrayLength`,
`maxNodes` and `maxDepth`; work and storage are linear in the encoded argument data.
This API writes attribute blobs; emitting source attributes and pseudo-attribute
flags/tables is tracked separately. The native gate is
`node packages/cil/tools/validate-custom-attributes.mjs`.

`decodeCustomAttribute(bytes, parameterTypes, options)` accepts the same type and
constructor-token contracts. It returns `{ success, constructorArguments,
namedArguments, diagnostics }`; malformed blobs return stable MD0100–MD0110 errors
without throwing. Typed constants are `{ kind, type, value }`; arrays contain typed
constants, Type values retain their serialized name, and large integers use BigInt.
Enums require known storage rather than an assumed Int32 width. The compiler importer
reuses this codec through its existing result adapter, preserving its historical
Int32 fallback when callers cannot resolve enum storage.

`encodeConstant(type, value, options)` returns `{ type, bytes }` for a Constant row.
Types are CLI element codes or primitive signature names. `decodeConstant(type,
bytes, options)` returns the value, using BigInt outside JavaScript's safe integer
range. Strings retain raw UTF-16 code units; null string/object values encode as
element type `0x12` and four zero bytes. Invalid types, values, lengths, budgets and
cancellation throw `CilError` with stable MD0120–MD0124 codes. The default `maxBytes`
is 1 MiB, with a 128 MiB hard maximum; `signal` supports cancellation.

`metadata.definitions.constantValue({ Parent, Type, Value }, options)` encodes a
primitive value, adds its Constant row and sets the existing Field, Param or Property
owner's HasDefault flag. It preserves other flags and returns the Constant token.
Parents must exist; MD0125–MD0127 reject invalid parents, duplicates and malformed
or replaced tables. `maxConstants` defaults to 100000 with a 1000000 hard maximum.
The append-only parent index is local to the builder and grows linearly; raw row
appends are indexed once. Do not rewrite already-indexed raw rows. Invalid inputs,
byte/count limits and cancellation leave metadata rows, flags and heaps unchanged.

The existing `metadata.definitions.constant({ Type, Parent, Value })` writer still
accepts encoded type and bytes without setting flags. The caller supplies the
correct primitive storage type (including enum underlying types); source constant
and default-parameter binding/emission remain separate. The compiler importer
uses the shared decoder. Native codec evidence is reproducible with
`node packages/cil/tools/validate-constants.mjs` against .NET SRM and reflection.
The typed-row writer's flags, default lookup and values are checked by
`node packages/cil/tools/validate-constant-rows.mjs` against SRM for all three parent kinds.

| Capability | API | Evidence |
| --- | --- | --- |
| Constant metadata values | `encodeConstant` / `decodeConstant` | Roslyn blobs, SRM and reflection |
| Primitive and constructed types | Type AST encoder/decoder | SRM BlobEncoder corpus |
| Methods, fields, locals, properties, MethodSpec | Signature AST encoder/decoder | SRM and Roslyn corpus |
| Existing string emission | Member signature adapters | Focused compatibility tests |
| Native execution of every signature form | Not implied by binary interoperability | Engine-specific qualification remains separate |

Malformed contexts, trailing bytes, null tokens, excessive depth/counts and array
ranks above 32 throw `CilError`. The AST codecs accept `{ maxDepth, maxNodes, signal }`
for bounded traversal and cancellation. No per-operation state survives disposal
of the returned byte array or AST. Run `node examples/il/signatures.mjs` for an
example and `node --test tests/a03-02-signatures.test.js` for the offline corpus.

The [metadata API](METADATA.md) exposes all 53 named table schemas, typed row writers,
deduplicated heaps, required sorting, uncompressed pointer lists and bounded II.22
structural diagnostics. See `examples/metadata/table-builder.mjs` for a runnable example.

The [PE API](PE.md) supports AnyCPU/x86/x64/ARM64 output, console/library headers,
desktop CLR import stubs, aligned multi-section layouts and all PE/CLI data directories.

`sha256(bytes)` is the shared synchronous SHA-256 implementation used by CIL and Portable PDB tooling.
It accepts a `Uint8Array` of at most 128 MiB, preserves the input (including subarray boundaries), and returns
an independent 32-byte digest. Invalid input types throw `TypeError`; oversized input throws `RangeError`.
The browser/worker implementation uses no host crypto or asynchronous work. `@sharpforge/symbols` retains
its existing `sha256` export as a reexport of this function; shared `sha1` is documented below.
Hashing reads complete 64-byte blocks directly from the input. Padding uses at most 128 bytes,
with one reusable 256-byte schedule and 32-byte state, so scratch storage is independent of input size.

Embedded data emission and bounded inspection are documented in [RESOURCES.md](./RESOURCES.md).

Paged named metadata rows, token references, physical file offsets and standard
heap records are available through [MetadataTableInspector](./METADATA-TABLES.md).

Win32 version, manifest and ICO emission is documented in [WIN32-RESOURCES.md](./WIN32-RESOURCES.md).

Opt-in [memory-prefix validation](PREFIX-MEMORY.md) checks volatile/unaligned/no. targets and duplicate prefixes.

Opt-in [type-prefix validation](PREFIX-CONSTRAINED.md) checks constrained/readonly lexical targets and type-token row extents.

The source-image emitter uses [nested exception-region layout](EMITTER-EXCEPTION-REGIONS.md) for catch/finally clause ordering and indexed transfers.
The opt-in [verifier type-system adapter](VERIFIER-TYPE-SYSTEM.md) resolves bounded local hierarchy relations and reports missing metadata as unknown.

The opt-in [typed numeric verifier](VERIFIER-NUMERIC.md) propagates primitive stack
types through decoded method blocks, with explicit rejected and unknown results.
Its registered [indirect memory policies](VERIFIER-MEMORY.md) check primitive
managed-pointer loads and stores while retaining storage-width distinctions.

`formatSignatureType(node, metadata, options)` optionally accepts
`formatType(node, formatChild)`, returning a display string or `undefined` to
use the default formatter. `formatChild` shares the original depth/node budget
and cancellation signal. This display hook does not change the signature AST
or its binary encoding; the callback-absent formatting contract is unchanged.

The opt-in [verifier member context](VERIFIER-MEMBERS.md) adds bounded, canonical local field/method declaration resolution to type relations.

`readMethodHeader(pe, methodToken)` reads owned scalar tiny/fat CIL header facts
(`fileOffset`, `headerSize`, `codeOffset`, `codeSize`, `sectionEnd`, `maxStack`,
`localSignature`, `moreSections`, `initLocals`) or null for an absent RVA.
It validates raw MethodDef tokens, RVA/header/code extents and never decodes IL
or exception sections. Invalid input throws `CilError`. `pe.methodBody` shares
the same header parser and retains its existing result shape.

Runtime admission checks [reachable try-entry stack heights](VERIFIER-HANDLER-ENTRY.md) before granting stack-capacity proofs.

`verifyCilAssembly` propagates execution stack heights through a bounded basic-block
worklist. It reuses decoded instructions and the EH offset map, merges incoming
states before queueing, and holds at most one pending entry per block. Handler
seeds and `leave` stack clearing retain the execution profile's existing behavior.
Stack failures retain `IL_STACK` and add the ILVerify category in `diagnostic`
(`PathStackDepth`, `StackUnderflow`, `StackOverflow` for those three conditions).

The optional limits `maxDataflowInstructions` (default/maximum 1,000,000),
`maxDataflowEdges` (4,000,000), and `maxDataflowSteps` (16,000,000) may only be
lowered to nonnegative safe integers. Steps charge every incoming edge/seed and
instruction in each processed block, including repeated visits. Exhaustion reports
`IL_LIMIT`/`CILDF0001`; cancellation through `signal` reports
`IL_CANCELLED`/`CILDF0002` during dataflow. Earlier decoding/EH cancellation keeps
its existing diagnostics. Failed admission never grants a stack-capacity proof.

The internal solver can reprocess changed immutable typed states using the existing
verification lattice, but the integrated execution policy still tracks heights.
Typed opcode transfers, definite initialization, filter execution and complete CLR
verification remain open under #2401 and the other SF-A03-T07 tasks.

`AssemblyInspector.summary()` retains the full existing metadata inventory and
method decoding behavior. Opt into bounded method pages with
`summary({ methodOffset: 0, methodLimit: 100 })`: the result contains assembly
header facts, `methods`, `diagnostics` and
`methodPage: { offset, limit, total, nextOffset }`. It omits full type/reference/
resource inventories. Page offsets follow physical MethodDef token order,
including images whose MethodPtr owner order differs; `nextOffset: null` means
there is no next nonempty page. Offset may equal the row count, and a zero limit
returns an empty page. Limit defaults to 100 and cannot exceed 1,000.

Only selected method definitions are looked up. With `includeMethods: false`,
pages return definitions without reading bodies. Otherwise the shared public
header reader preflights every requested body before decoding, charging each
occurrence even when RVAs alias. `maxPageCodeBytes` defaults to 1 MiB and may be
lowered to zero. Invalid pagination or an over-budget page throws `CilError`;
malformed individual methods retain existing per-method diagnostics. `signal`
supports cancellation. Returned page methods own their nested data. Existing
metadata/body limits and inspector caches remain active; the byte budget is
logical declared code size, not a measured process-memory ceiling.
Construction still reads metadata and indexes member names/ownership; paging
defers method signature/body projection and the unrequested full inventories.

`inspector.tokenUri(token)` returns
`sf-metadata://<module-mvid>/0x<eight-hex-token>`. `inspector.resolveUri(uri)`
returns `{ mvid, token }` for a valid identity in the same module, including after
reloading its PE bytes. These methods never decode bodies or load assemblies.
Every existing metadata-row token and bounded user-string token is supported;
nil, non-integer, overflow, missing-row/heap, malformed URI and foreign-MVID
inputs throw `CilError`. URI parsing accepts hex/scheme case variations and
rejects additional query/fragment/escaped components. Modules without a nonzero
MVID have no stable URI. An MVID is a metadata identity, not a content hash or
signature verification; changed-module versions require their own URI.


### Cross-assembly definition index

`new AssemblySymbolIndex(loadedInspectors, options)` snapshots TypeDef, Field,
MethodDef, Property and Event definitions from loaded `AssemblyInspector` instances.
It never reads method signatures or bodies, loads another assembly or retains an
inspector, PE byte view or mutable metadata tree. Each owned record is
`{ id, token, kind, name, declaringTypeId }`; `id` and non-null declaring type IDs
use the existing canonical MVID/token navigation URI. Nested types retain their
existing inspector display names; this API does not resolve referenced/constructed
types or verify MVID content identity.

`get(id)` returns an owned record or null for an unknown/noncanonical ID. `page({
offset, limit, signal })` returns `{ entries, total, nextOffset }`, with default
limit 100 and maximum 1000. Order is input module, TypeDef, then each type's fields,
methods, properties and events in inspector ownership order (including MethodPtr).
`size`, `modules()` and `storage` expose owned scalar counts/module facts. Zero-length
pages return `nextOffset: null`, matching the inspector's method-page convention.
Duplicate module MVIDs and duplicate/incomplete definition ownership reject with
`CilError`; constructing a new index after reload produces the same IDs.

Options are lowerable integer budgets: `assemblies` 256, `entries` 100000,
`nameBytes` 16 MiB and `bytes` 32 MiB. Names have a hard 4096 UTF-16-code-unit limit.
Counts are checked before traversal; total name/payload sizes are checked before
allocating symbol records. `storage.nameBytes` charges each name occurrence at two
bytes per UTF-16 code unit. `storage.bytes` charges each record's name, kind, 61-character
ID and optional 61-character owner ID at two bytes per code unit plus a four-byte token,
and each module's 36-character MVID plus four-byte entry count. Repeated names/owner IDs
are conservatively charged each time. These logical payload and count bounds exclude
JavaScript Map/object/array overhead, pre-existing inspectors and output pages; they
are not a measured heap or process-memory ceiling. Storage is O(definitions+name
payload), construction is linear in those inputs, lookup is a Map lookup and pages
visit only requested entries. Cancellation is checked at module/type boundaries and
at most 256 member/page records apart. The index is a fixed owned snapshot; recreate it
when the loaded module set changes. Reference binding and usage analysis remain
separate capabilities; bounded name search is described below.

The 20-assembly/reload, ownership, count/storage boundary and retained native PE
tests pass with the focused Chromium/Firefox/WebKit checks on macOS. Exact scope,
logical storage counters, timings and raw evidence are recorded in
`tests/fixtures/assembly-index/README.md`; broader platform qualification is separate.


### Paged symbol-name search

`index.search(query, { mode, offset, limit, resultLimit, cacheBytes, signal })` searches
an `AssemblySymbolIndex` without metadata/signature/body reads. It returns owned
`{ entries, nextOffset, capped }`; entries retain the existing stable IDs and input
module/type/member ordering. Paging counts matching records, not source rows.
`nextOffset` is present only when another match exists within `resultLimit`; `capped`
is true only when an additional match was observed beyond that total-result cap.
Zero-limit pages return no records and `nextOffset: null`. No full candidate/result
array is built; only returned records are copied, once per returned occurrence.

Modes use JavaScript Unicode `toLowerCase()` with no locale or normalization:

- `prefix` matches the full name or simple name after the last `.`, `+` or `/`.
- `substring` (default) matches a literal substring of the full name.
- `camel` matches an abbreviation as an ordered subsequence of name initials.
  Initials include word starts, every uppercase letter (including acronym letters),
  and the first digit of each digit run. Namespace/nested-name separators and
  underscores start words. Unicode letters/digits/combining marks belong to words;
  uncased scripts contribute their first character after a separator. For example,
  `NRE` matches `NullReferenceException`, `XR` matches `XMLReader`, and `éf` matches
  `ÉclairFactory`. This is initials matching, not fuzzy edit-distance matching.

Query whitespace and punctuation are literal; no regular expression, glob, NFC or
locale-specific/full Unicode case folding is implied. Empty queries match every
record in index order and require no name cache. Queries are limited to 256 UTF-16
code units; modes other than the three above reject. `limit` defaults to 100 and is
an integer 0..1000; `resultLimit` defaults to 10000 and is an integer 1..10000;
`offset` is an integer 0..resultLimit. Invalid input raises `CilError`. Cancellation
is checked before work, at most 256 records apart and before publishing results.

The first nonempty query with a nonzero page lazily builds parallel normalized-name,
initials and simple-name-position arrays over the index's existing private records.
The independent `cacheBytes` budget defaults to/hard-caps at 64 MiB and can be lowered
to zero. A complete first pass charges the exact UTF-16 name/initial payload plus
one Uint16 position per record before allocating retained arrays/strings; individual
scratch names remain bounded by the index's 4096-unit limit. A cancelled/over-budget
build publishes no partial cache. Reusing a cache with a smaller budget than its
recorded cost rejects when the query requires it. `index.searchStorage` returns
owned `{ entries, bytes }` counters, initially zero. Empty queries/zero pages use no
cache and do not evict an existing cache. These are logical payload bounds, excluding
engine array/string/object overhead and the existing index; no process-heap ceiling
is claimed.

Cache construction and queries scan bounded names/records linearly; queries create
no full candidate array. A query can stop after locating its page plus one following
match, or the result cap plus one match. The fixed 50,000-type cold/warm timing
criterion passed on Node and Chromium/Firefox/WebKit on macOS after the retained
initial failure prompted an ASCII preflight optimization. Exact samples, host,
reference checks and qualification limits are in `tests/fixtures/symbol-search/README.md`;
these measurements do not imply an untested-platform or universal latency guarantee.


`sha1(input)` reuses the existing symbols SHA-1 implementation and returns an owned
20-byte digest without mutating the input. `@sharpforge/symbols` reexports that same
function, preserving its byte-array/array-like input behavior and input-sized
padding allocation. It does not impose a new byte limit or claim constant scratch
space; bounded callers must preflight their inputs. The cross-assembly browser
binder uses it to derive declared strong-name tokens; hashing a key does not verify
an assembly signature. This extraction is implementation-ready, with focused
vectors, padding boundaries and symbols compatibility tests pending the serial slot.

### Cross-assembly type hierarchy

`new AssemblyTypeHierarchy(index, inspectors, options)` builds an opt-in graph over
an existing `AssemblySymbolIndex` and the same set of loaded `AssemblyInspector`
modules. It reuses the index's MVID/token IDs and display records, while owning only
resolved hierarchy edges and scalar diagnostics. No bodies are decoded, assemblies
loaded, code executed, or PE/metadata views retained. Later inspector mutations do
not change queries. The existing verifier's bounded exact UTF-8 name index and
NestedClass validation are reused only during binding and then discarded.

Assembly references match declared name/culture (case insensitive), exact four-part
version, content type and public-key token. Full keys are bounded before deriving
tokens with the shared SHA-1 helper. This is nominal metadata binding, not signature
verification, weak-name version unification or a runtime loader policy. Duplicate
matching assembly identities are ambiguous. Type names/namespaces use exact bytes
and lexical enclosing tokens, not display-name concatenation; nested references
can cross assembly boundaries. Duplicate candidate type names remain ambiguous.

`hierarchy.tree(typeId, { direction: 'base' | 'derived' | 'implementers',
maxQueryNodes, maxDepth, signal })` returns a fresh tree or null for an unknown ID.
Each node has `{ symbol, relation, diagnostic, repeated, children }`. Known symbols
are owned index records; unresolved nodes have `symbol: null` and an owned diagnostic
`{ referenceId, name, reason }`. Base trees follow the direct base followed by direct
interfaces; derived trees follow class bases or subinterfaces. Implementer trees
require an interface root and include subinterfaces, implementing classes and their
subclasses. Order follows input modules/TypeDefs and InterfaceImpl rows. A repeated
DAG node retains its identity but has no expanded children; cycles are malformed.

Missing assemblies, ambiguous identities/names and unresolved names produce dead
nodes. Retargetable references, ModuleRef/netmodule binding, nil resolution scopes,
ExportedType forwarding and TypeSpec/constructed-base substitution require policies
not supplied here and remain explicit unresolved results. Open TypeDef declarations
can appear as nodes; this graph does not claim constructed generic assignability,
variance, access checks or whole-type validity. Malformed indices, ownership,
cycles and class/interface edge kinds throw `CilError`.

Construction budgets default to/hard-cap at 256 `maxAssemblies`, 100,000 `maxTypes`,
300,000 `maxRows` across relevant tables, 200,000 `maxEdges` (one potential base per
type plus every InterfaceImpl), 16 MiB `maxNameBytes` and 1 MiB `maxKeyBytes`.
All row/count and every name/key occurrence charges are checked before retained
records, names or digests are created, including aliased heap handles. Individual
name components are limited to 1 KiB UTF-8 and keys to 16 KiB. The shared name index
also bounds lexical nesting and reference scope chains to 64 levels. These budgets
exclude earlier inspector/index construction and engine overhead.

Query budgets default to/hard-cap at 10,000 `maxQueryNodes` and depth 256; both may
be lowered at construction and again per query. Every returned occurrence, including
a repeated or dead node, consumes the node budget. A query builds children one at
a time with an iterative work stack and fails before exceeding its limit. `signal`
cancels construction or a query. Invalid lowerable limits throw `CilError`.
`hierarchy.storage` returns owned input count/byte charges, not retained heap size.
Construction is linear in bounded metadata/name bytes plus resolved edges; queries
visit each expanded type once and are bounded by returned occurrences. The feature
and retained native reference are prepared but unvalidated; see
`tests/fixtures/type-hierarchy/README.md` for the scheduled evidence plan.

### Instruction usage analysis

`new AssemblyUsageAnalysis(inspector, options)` snapshots instruction occurrences
for one loaded module without executing it or retaining its PE, decoded bodies,
inspector, signature ASTs or binding context. It reuses the existing bounded CIL
member/type resolver and its caches. The legacy `inspector.callGraph()` keeps its
complete list, method-error records and ordinary decorated-method cache behavior.

`analysis.query(relation, token, { offset: 0, limit: 100, signal })` returns owned
`{ entries, total, nextOffset, complete }` in physical MethodDef/IL order. Pages
have at most1000 occurrences; zero-length/past-end pages have no continuation.
There is no per-query whole-result scan/copy. Each entry contains source/operand/
resolved-target tokens, stable source/target MVID token URIs, offset, opcode,
resolution status/reason and an optional instantiated-type token. Local MemberRef
aliases share canonical definition queries while their raw-token queries retain
the exact encoded occurrences. Unsupported/external bindings retain raw identities
and explicit `unknown` reasons, never a display-name match.

Supported relations are `uses` (MethodDef's non-string token operands), `used-by`
(reverse occurrences), `instantiated-by` (`newobj`'s declared type), and
`assigned-by` (direct `stfld`/`stsfld` writes). `newarr` uses its element type but
does not construct an element instance. Indirect writes, virtual dispatch targets,
reflection and dynamic execution are not inferred. `overridden-by` and
`implemented-by` remain unsupported pending a genuine host-provided canonical
method-slot contract; issue #2573 remains open for those capabilities.

Construction options independently lower hard maxima: `maxMethods:16384`,
`maxCodeBytes:4194304` (all body occurrences, including shared RVAs),
`maxMethodCodeBytes:1048576`, `maxInstructions:250000`, `maxUsages:100000`, plus
`signal`. All method headers/code sizes are checked before IL or binding snapshots;
only one method's decoded instructions are held at a time. Each occurrence has
at most seven index entries. `metadataLimits` forwards lowerable limits to the
existing verification context; its defaults bound rows, names/signatures and
query depth independently. These are logical/count bounds, not measured heap
ceilings. Invalid limits/metadata/IL throw `CilError`; unsupported non-CIL bodies
produce owned `diagnostics`, and pages then report `complete:false`. Completeness
covers CIL body scanning, not resolution of every external reference.

[Focused fixtures and pending qualification](../../tests/fixtures/usage-relations/README.md)
cover the initial four relations; broad execution/cross-platform coverage is not
implied by metadata inspection.
