# @sharpforge/symbols

Portable PDB read/write, embedded symbols, source validation and PE binding. Pure ES modules; depends on @sharpforge/cil and @sharpforge/archive. Main exports include readPortablePdb, emitPortablePdb, loadSymbols, attachPortablePdb, bindSources, readDebugDirectory, sourceLinkUrl and SHA/DEFLATE helpers.

```js
import {loadSymbols,bindSources} from '@sharpforge/symbols';
const symbols=loadSymbols(assemblyBytes,pdbBytes);
const binding=bindSources(symbols,{'/src/Program.cs':sourceBytes});
// Only checksum-verified source enters binding.sources.
```

All eight debug tables are parsed; unknown CDI retains raw bytes. PE CodeView/embedded identity and SHA256/SHA384/SHA512 checksums are checked. SHA1/SHA256 automatic source binding; SHA384/512 through verifySourceAsync. Source Link does not implicitly access the network. Writer interoperability with native Visual Studio/CLR has not been qualified. See the source distribution's docs/advanced-debugging-winui.md and tests/portable-pdb.test.js for contracts, limits and provenance.

Implementation is separated into sequence point codecs, metadata reader and builder, PDB writer, PE debug directory, identity binding and source binding modules. The package entry point remains the public contract; consumers do not import these internal modules directly.

`emitPortablePdb(assembly, debug)` accepts `debug.importScopes` in row order;
`parent` is zero or an earlier one-based scope id. Each scope has `definitions`
using Portable PDB import kinds 1–9 (`alias`, `namespace`, AssemblyRef row id
`assembly`, and metadata token `type`, as applicable). A debug method may supply
`importScope` and `constants`, or explicit `scopes` containing IL-byte `start`
and exclusive `end`, `locals`, `constants` and `importScope`. The root scope spans
the method body; child scopes must be nested or disjoint. Existing compiler PC
scopes remain accepted. Constants accept primitive `type`/`value` pairs, optional
`enumType` metadata tokens, or a compiler-provided `signature` Uint8Array. Use
BigInt for 64-bit integers. Invalid names, ranges, imports and references throw
`SymbolError`.

`readPortablePdb` reads complete primitive and enum LocalConstant signatures,
ordered `customModifiers` (`required`, `typeToken`), object/string null and typed
class null. Existing character values remain numeric UTF-16 units and 64-bit
integers remain BigInt. Strings preserve BOMs, embedded NUL and unmatched UTF-16
surrogates. Enums retain the historical coded `enumType` and additionally expose
the full `enumTypeToken` and `enumTypeVerified: false`; standalone reading does
not resolve enum definitions.
Typed null exposes `type: 'class'`, `typeToken` and `value: null`.
Malformed Boolean values, fixed-width payloads, trailing data and out-of-range
handles fail explicitly. Type-dependent general constants (including decimal,
DateTime and value-type defaults) retain owned `raw` bytes and expose
`decoded: false`, `reason: 'type-metadata-required'`, `typeKind`, `typeToken` and
`defaultValue` (whether the payload is absent). Their values are not guessed.

Reader options `maxConstantBytes` (16 MiB default, 64 MiB hard cap) and
`maxConstantEntries` (100,000 default, 1,000,000 hard cap, counting rows plus
custom modifiers) bound aggregate allocations before copying any constant.
`maxConstantModifiers` defaults to 64 per
constant, capped at 1,024. Constant names are capped at 3,072 UTF-8 bytes before
decoding and 1,024 UTF-16 units afterward. These options also apply through
`loadSymbols`. Native C# examples and offline reference data are in
`interop/LocalConstants` and `tests/fixtures/portable-pdb-local-constants`.

`symbols.effectiveImports(importScopeId)` returns fresh import records for a
LocalScope's `importScope`, ordered from the outermost parent to the selected
scope, retaining each blob's recorded order. Zero returns an empty list; invalid
ids fail explicitly. All nine Portable PDB import kinds retain their original
fields and gain `scopeId`, `resolved` and `reason`. Bound `loadSymbols` results
also add `assemblyName` for AssemblyRef row ids and `typeName` for TypeDef,
TypeRef and TypeSpec handles (including nested and constructed types). Names
describe declared metadata; referenced assemblies are not loaded. Standalone
and explicitly unbound PDBs leave handle-bearing entries `resolved: false` with
`reason: 'type-metadata-required'`; namespace/XML/alias-only records need no PE.

The list preserves alias declarations/references and duplicates so the expression
language can apply its own lookup and shadowing rules. It does not reconstruct
source ordering discarded by a compiler. Import scopes are capped at 100,000,
parent depth at 256 and aggregate definitions at 100,000; graph validation is
linear and queries take O(depth + returned entries), without caching flattened
copies of every ancestor list. Names are bounded before UTF-8 decoding (4 KiB
each / 4 MiB aggregate). Bound name resolution caps distinct type/assembly
handles at 4,096, TypeSpec blobs at 4 KiB each / 1 MiB aggregate, ASTs at depth
32 / 256 nodes, and resulting type names at 4,096 characters / 1 MiB aggregate.
Existing metadata-name bounds apply; a referenced local type permits at most
65,536 NestedClass rows. Public import arrays, metadata and returned records
cannot mutate later queries. The native nested C# namespace fixture and SRM
reference are captured by `scripts/validate-pdb-effective-imports.mjs`.

`symbols.scopeTree(methodToken)` returns fresh lexical root nodes in table order.
Nodes contain `id`, IL-byte `start`/exclusive `end`, `importScope`, `locals`,
`constantIds` (rows in `symbols.constants`) and nested `children`. Each local
retains `id`, slot `index`, `name`, `attributes`, and exposes `compilerGenerated`
from Portable PDB's DebuggerHidden flag. Equal ranges nest in table order;
disjoint ranges form siblings. No lexical scope is invented for methods with no
LocalScope rows. Invalid MethodDef tokens fail; valid methods without scopes
return `[]`.

Bound `loadSymbols` joins slots to the PDB's StandAloneSig handle, falling back
to the PE method header when sequence-point data is absent. Locals expose a
lossless CIL signature AST `type`, declared `typeName`, and `typeReason: null`.
Generic parameters, custom modifiers, pinned locals and byrefs remain in the
AST; no generic substitution, referenced-assembly loading or runtime-value
inference occurs. Standalone/unbound locals have null type/name with
`typeReason: 'type-metadata-required'`; a missing signature yields
`'missing-local-signature'`. Invalid signatures and out-of-range slots fail.
Public PDB records and returned trees/ASTs cannot mutate later queries.

Scope construction is linear; queries cost the returned tree and distinct local
signature ASTs. Bounds are 100,000 combined scopes/local declarations/constant
references, depth 256, local names 3,072 UTF-8 bytes/1,024 UTF-16 units each and
1 MiB aggregate UTF-16 units. Unique local signatures are preflighted at 4 KiB
each / 128 KiB aggregate before decoding, with depth 32 / 4,096 AST nodes;
each displayed type uses the existing 256-node and metadata-name limits above.
Types are snapshotted once per load, and a query clones each used slot's AST
once even when the slot is declared in multiple scopes. Native nesting and
local types are compared with SRM by `scripts/validate-pdb-scope-tree.mjs`.

LocalVariable/LocalConstant dynamic and tuple CDI is joined by its exact parent
row. Annotated scope locals retain `dynamicFlags` and `tupleElementNames`, with
`displayTypeName` such as `dynamic[]` or `(int a, string b)`; `type`/`typeName`
remain the declared CLI signature. Annotated constants expose the same fields
on `symbols.constants`; scopes additionally expose `constantAnnotations` with
owned `{id, name, ...annotationFields}` views alongside `constantIds`. Values
and constant decoding status are unchanged.

Dynamic flags follow type occurrences, including generic arguments, arrays,
byrefs and function pointers, with omitted trailing zero bits accepted.
Custom modifiers and pinning do not consume dynamic flags. Tuple names follow
Roslyn's reverse nested decoding, including long ValueTuple rest chains.
Tuple shorthand requires a metadata-declared framework ValueTuple identity;
same-named custom-assembly types do not qualify. This reuses the bounded
framework identity checks below, without loading or authenticating assemblies.

Unbound locals and type-dependent constants keep `displayTypeName: null` and
`annotationReason: 'type-metadata-required'`. Primitive constants can be
annotated without a PE. Mismatched annotations keep their raw fields and expose
`dynamic-type-mismatch`, `tuple-name-count-mismatch` or `tuple-type-mismatch`;
no source spelling is guessed. Referenced TypeSpec constants are decoded for
display only, not interpreted as runtime values. Tuple labels preserve PDB text;
this display is not a C# source serializer.

Before CDI decoding, annotation parents and duplicate kinds are checked; limits
are 4,096 records, 1 MiB aggregate bytes, 1,024 flags/names per record and 65,536
aggregate flags/names. Tuple labels are limited to 3,072 UTF-8 bytes before
allocation, then 1,024 UTF-16 units each / 4,096 per record. Annotation traversal
is bounded at depth 32 / 256 nodes; occurrence copies avoid conflating shared
primitive AST nodes. Existing metadata-name/output and constant TypeSpec budgets
also apply. Display facts are computed once at load and queries copy owned data.
The existing two-version Roslyn CDI capture is reused by
`tests/a13-04-local-annotations.test.js`; new native end-to-end qualification is
not claimed by this increment.

For bound local TypeDef enums, `loadSymbols` verifies the metadata-declared
framework `System.Enum` base and exactly one special `value__` instance field.
Its scalar signature must match the constant's encoded kind; mismatches,
unsupported bases and malformed fields fail explicitly. Successful checks set
`enumTypeVerified: true`; this verifies base identity and underlying scalar type,
not every ECMA type-definition rule. TypeRef/TypeSpec enums and unbound symbols
retain decoded scalar values with `enumTypeVerified: false`; external assemblies
are not loaded. FieldPtr indirection and field custom modifiers are supported.
Before list expansion, the binder caps selected enums at 1,024 and fields at
4,096 per enum / 65,536 total. Inspected instance-field signatures are capped at
4 KiB each / 1 MiB total, with decoder depth 32 / nodes 256; names use the same
bounded metadata-name reader. Definitions are checked once per load and no PE
views or signature ASTs escape. This reuses the captured native C# short enum.

For bound symbols, `loadSymbols` recognizes a top-level `System.Decimal` or
`System.DateTime` TypeDef/TypeRef only when its declared assembly scope matches an invariant-culture
framework identity: `System.Runtime` / `b03f5f7f11d50a3a`,
`System.Private.CoreLib` / `7cec85d7bea7798e`, or `mscorlib` / `b77a5c561934e089`.
AssemblyRef tokens and full public keys are supported; TypeDef requires its own
Assembly public key. This checks declared metadata identity without loading
assemblies or verifying signatures. Custom-assembly lookalikes remain unresolved.
The binder caps inspected assembly scopes at 1,024, each public key at 16 KiB
and aggregate key bytes at 1 MiB before hashing. Decimal
constants expose `type: 'decimal'`, exact decimal text in `value`, and
`decimal: { coefficient, scale, negative }`; `coefficient` is an unsigned 96-bit
BigInt. Trailing fractional zeroes and the sign bit of zero are preserved without
floating-point conversion. Their complete signature, raw bytes and type token
remain available. Payload length must be 13 bytes and scale must be 0–28.
Standalone PDBs and explicitly unbound symbols remain unresolved. TypeSpec,
nested same-name types and other type-dependent payloads remain outside
this binding increment. The native reference uses SRM `BlobReader.ReadDecimal`;
constructed boundary cases test the full coefficient, scale and sign encoding.

DateTime constants expose `type: 'datetime'`, exact BigInt ticks in `value`, and
`dateTime: { ticks, kind: 'unspecified' }`. A tick is 100 nanoseconds from
0001-01-01 in the Gregorian calendar. The payload must be exactly eight bytes;
negative ticks and values above 3155378975999999999 fail explicitly. The
representation preserves all ticks without converting to JavaScript Date or
inferring UTC/local time. The same declared framework identity checks, owned raw
signature, modifiers and unbound behavior apply. VB Date literals and SRM
`BlobReader.ReadDateTime` are captured by
`scripts/validate-pdb-datetime-constants.mjs`; offline tests read that corpus.
Calendar formatting, time-zone conversion, DateTimeOffset and general type
resolution are separate capabilities.

Payload-free `VALUETYPE` constants referencing a TypeSpec for `System.Nullable<T>`
now bind to `type: 'nullable'`, `value: null`, `decoded: true` and
`defaultValue: true`. The original TypeSpec token and owned raw signature remain
available. This represents the boxed default (no value), not a fabricated value
of `T`. The nullable definition uses the same declared framework identity gate.
Closed arguments supported here are Boolean, Char, signed/unsigned integer widths,
Single, Double, IntPtr, UIntPtr and identity-checked Decimal/DateTime. Other
constructed types, generic variables, modified arguments and nonempty nullable
payloads remain explicitly unresolved. TypeSpec count (1,024), each blob (4 KiB)
and aggregate bytes (1 MiB) are checked before decoding; each AST has depth 32
and node 256 limits. ASTs/PE views do not escape the load. The native reference
uses SRM-built metadata and CLR boxed defaults, not C# nullable const declarations.

Source documents accept `hashAlgorithm` and `language` GUIDs and a `hash`
Uint8Array. SHA-1, SHA-256, SHA-384 and SHA-512 are computed synchronously when omitted;
supplied hashes are checked against the exact source bytes. Hash inputs are exact source
bytes, including BOMs and line endings. Document path components are deduplicated
using System.Reflection.Metadata's separator selection. Portable PDB has a
language column and no vendor column. References: the
[Portable PDB v1.0 specification](https://github.com/dotnet/runtime/blob/main/docs/design/specs/PortablePdb-Metadata.md)
and [SRM document-name encoder](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Reflection.Metadata/src/System/Reflection/Metadata/Ecma335/MetadataBuilder.Heaps.cs).

The independent [native gate](interop/README.md) checks emitted imports, constants,
document-name bytes, hashes and debug directories with System.Reflection.Metadata.
Its checked-in report records the exact tools and cases; this qualification does
not cover native debugger behavior or the rest of the A13 workstream.

Known Windows PDB MSF 7.00/2.00 and legacy CodeView NB09/NB10/NB11 inputs fail
with `SymbolError.code === 'SF_SYMBOL_UNSUPPORTED_FORMAT'` and a descriptive
`format`. They are not parsed as corrupt Portable PDB metadata.

`readCustomDebugInformation(kind, bytes, limits)` and
`writeCustomDebugInformation(kind, record)` expose bounded CDI codecs. EnC slot
maps use `slots` (`kind: null` for a temporary); lambda maps expose
`methodOrdinal`, `closures` and `lambdas`; state maps expose `states` with signed
`stateNumber`, `syntaxOffset` and `relativeOrdinal`. The optional
`syntaxOffsetBaseline` preserves Roslyn's encoded baseline. Unknown CDI kinds
retain `bytes`. A supplied `bytes` property requests exact raw preservation.
`debug.custom` accepts records with `parent` metadata tokens and `kind` GUIDs;
`debug.stateMachines` accepts `moveNext`/`kickoff` MethodDef token pairs.

Compilation CDI codecs expose dynamic `flags` (LSB first, trailing zero bytes
omitted), tuple `names` (null for unnamed elements), default `namespace`,
compilation `options`, metadata `references` (including MVID, aliases, flags,
timestamp and image size), type `documents` and the empty `primaryConstructor`
marker. Strings are strict UTF-8; terminated fields, duplicate option names,
counts and payload sizes are checked. EnC wire details follow Roslyn's
`EditAndContinueMethodDebugInformation`; primary-constructor markers follow its
`MetadataWriter.PortablePdb` emitter. Native fixture qualification is separate
from synthetic codec round trips.

Embedded sources of at least 200 bytes use the archive package's bounded
fixed-Huffman DEFLATE encoder when smaller; short/incompressible sources retain
raw representation. Embedded Portable PDB entries use the same encoder. This is
real compression, independent of platform CompressionStream availability.

`attachPortablePdb` replaces prior symbol entries, preserves other directory kinds
and overlays, honors the PE's actual section/file alignment, and updates overlay
file pointers. `checksum` accepts `true` (SHA256), `false`, or SHA256/SHA384/SHA512;
`reproducible` defaults to true. Existing digital signatures require re-signing
following any PE mutation. `readDebugDirectory(assembly, { maxBytes })` exposes an
embedded entry's `pdb` through a lazy, per-entry cached getter; declared sizes are
checked before decompression. `loadSymbols` applies the same budget and verifies
all three standardized checksum algorithms. The parsed result's `pdbOffset` records the
zero-based #Pdb stream position used to zero the identity while hashing.

| Capability | Writer and reader coverage |
| --- | --- |
| Documents | Deduplicated names; SHA-1/256/384/512; arbitrary language GUIDs |
| Locals and imports | Lexical scopes, primitive/enum/modified/typed-null constants, explicit unresolved payloads, import kinds 1–9 |
| State machines and CDI | Async/iterator links, EnC maps, seven compilation records, raw unknown records |
| PE binding | CodeView, reproducible, checksums, embedded PDB, existing entries/overlays |
| Native formats | Windows MSF and legacy CodeView detected with explicit unsupported errors |

The native gate and `tests/a13-01-*.test.js` provide runnable writer examples.
Recorded validation covers Node 24 on macOS arm64 and native SRM on .NET 10 with
Roslyn 4.8/5.3. Browser, Windows/Linux host, Rust/Wasm and Visual Studio debugger
qualification were not run for this batch. The symbols library has no native
execution backend and does not by itself establish VM execution parity.

`decodeSource(rawBytes, { fallbackEncoding: 'windows-1252', maxBytes: 16777216 })`
returns `{ text, encoding, bomBytes }`. It detects UTF-8/UTF-16 LE/BE BOMs, defaults
to strict UTF-8, preserves line endings, and uses an optional TextDecoder-supported
fallback only when BOM-less UTF-8 decoding fails. Invalid text, unknown encodings,
UTF-32 BOMs and byte-budget violations raise `SymbolError`. Decoding alone does
not verify a document. `bindSources(symbols, sources, options)` accepts the same
options, verifies exact raw bytes including BOMs and line endings first, and only
then decodes trusted text; bound documents expose their selected `encoding`.

`createSourceFetcher({ fetch, requestPermission, allowedOrigins })` creates an
explicit source client. Both the transport and permission callback are injected;
construction does not fetch. `await client.fetch(document, url, { signal })`
returns a `SourceStatus` result with verified bytes/text only after its raw-byte
SHA-1/256/384/512 checksum matches. Verification prefers WebCrypto; SHA-1/256
also have a portable fallback, while SHA-384/512 require WebCrypto. For example,
allowlist an exact HTTPS origin
and have the host's existing origin-grant service answer
`requestPermission({ origin, url, purpose, signal })`. Permission must return
literal `true` before every request, including redirects. Requests omit credentials,
referrers and caching; an injected transport must honor these Fetch options.

Defaults are 16 MiB per response, 15 seconds including permission/verification,
three redirects and four concurrent requests. Options `maxBytes`, `timeoutMs`,
`maxRedirects` and `maxConcurrent` tune these bounded limits. At most 65,536 stream
chunks are accepted; byte and time limits remain enforced without Content-Length.
Bodies must expose a readable byte stream so the client can enforce limits before
allocating a full response. Temporary chunk copies plus the result use at most
roughly twice `maxBytes`, plus bounded chunk bookkeeping. Cancellation and
`client.dispose()` stop pending waits even if a transport ignores AbortSignal.
Cleanup rejections are retained in the client's last 16 `cleanupErrors` strings.

Denied, mismatched, timed-out, malformed and unavailable sources return unverified
results with null bytes/text and an explicit status/reason. Invalid construction
options throw `SymbolError`. `fallbackEncoding` is opt-in and is used only after
raw checksums pass. Browser CORS restrictions still apply; opaque redirects cannot
be approved and are rejected. Network requests are never initiated by the reader
or by source mapping alone.

`sourceLinkUrl(symbols, documentName, { ignoreCase: true, maxMappings: 10000 })`
resolves the [Source Link mapping specification](https://github.com/dotnet/designs/blob/main/accepted/2020/diagnostics/source-link.md)
without network access. Both path separators are normalized; exact matches win,
then the longest wildcard prefix. Case-sensitive matching remains the default for
backward compatibility; `ignoreCase` enables simple Unicode uppercase comparison
without multi-character expansions. Captured path segments preserve casing and
use percent-encoding, including literal percent signs and URI-reserved punctuation.
Wildcards must terminate the document pattern and occur exactly once in its URL.
Ambiguous normalized patterns, invalid Unicode, dot segments and selected URLs
outside credential-free HTTPS raise `SymbolError`. Paths/URLs are limited to
32,768 UTF-16 code units; `maxMappings` bounds a linear scan of the mapping table.
This mapping capability does not fetch or grant access to an origin.

`portablePdbKey(path, pdbId)` and `peSymbolKey(path, { timestamp, sizeOfImage })`
produce [SSQP keys](https://github.com/dotnet/symstore/blob/main/docs/specs/SSQP_Key_Conventions.md).
Paths accept both separator styles; keys use lowercase basenames, the PDB GUID
with `FFFFFFFF`, or an eight-digit uppercase PE timestamp followed by a minimal
lowercase image size. The PDB input is its complete 20-byte identity; its timestamp
does not participate in the key. Filename casing uses simple per-codepoint
lowercasing without contextual or multi-character expansions.

`createSymbolServer({ serverUrl, fetch, requestPermission, allowedOrigins })`
reuses the source client's explicit origin grants, bounded streaming, redirects,
timeout, cancellation and disposal. It never performs implicit lookup. Methods
`lookupPortablePdb(name, id, { signal, assembly })`, `lookupForAssembly(assembly,
{ signal })`, and `lookupPE(name, identity, { signal })` return `SourceStatus`
results with artifact bytes only after identity checks. URLs preserve the server
prefix and escape filenames. The default artifact limit is 64 MiB. Both public
assembly inputs are copied before permission or transport callbacks run. Assembly-derived
lookup reuses that owned snapshot internally, avoiding a second full assembly copy.
The [Node allocation benchmark](benchmarks/symbol-copy-node24.json) records paired measurements
at the permission boundary; it does not measure downloads or PDB verification.

`identityVerified` describes the requested identity match; it is not a digital
signature. `checksumVerified` is true only when an assembly-bound PDB lookup also
validates its debug-directory checksum. Without the optional assembly, PDB
lookup still compares all 20 identity bytes; PE lookup compares timestamp and
image size. The current PE payload verifier accepts managed CLI images through
the existing CIL inspector. Pure PE key generation accepts headers from any PE;
native PE, MSF PDB, ELF, Mach-O, compressed-store files and pointer-file payloads
are not supported by this lookup client and cannot be returned as verified.
Ordinary tests use captured dotnet-symbol keys and injected transports offline.

`await resolveSources(symbols, { sources, fetcher, signal })` tries workspace
sources (a Map or name-keyed object), embedded bytes, then an explicitly supplied
source client in that order. Missing, mismatched or undecodable candidates fall
through. Each document reports `status`, `verified`, `provenance` (`workspace`,
`embedded`, `source-link` or null), `attempts`, and verified `bytes`/`text` only.
Results reuse the debugger binding shape (`documents`, `sources`, `sequencePoints`,
`methods`); unverified documents have no sequence points. Even an injected fetcher's
claimed verified bytes are checked again at the resolution boundary.

Resolution is sequential, abortable and bounded by `maxDocuments` (10,000),
`maxBytes` per candidate (16 MiB), `maxTotalBytes` across attempted verification
(64 MiB), and `timeoutMs` for the whole operation (30 seconds). Remote response
allocation is separately bounded by the source client's own limit before the
resolution verification budget is applied. `fallbackEncoding` controls decoding;
`mapping` passes options to `sourceLinkUrl`. Cancellation and timeout leave pending
documents unverified. The caller owns the supplied fetch client's lifetime.
Local projection builds one method-token index per binding call. Scope processing
is linear in methods, scopes and variables, preserves scope/variable order, and
does not retain stale results between bindings.

A result from `loadSymbols(assembly, pdb)` exposes
`symbols.hoistedLocals(methodToken, moveNextOffset)`. It returns
`{ available, reason, moveNext, kickoff, locals }`. For supported bound symbols,
each live local contains `name`, `fieldToken`, `fieldName`, zero-based `slot`,
`startOffset` and exclusive `endOffset`. The method token may be the kickoff or
MoveNext token; the offset is always relative to MoveNext IL. This maps names and
field identities, not field values.

The current convention is Roslyn C# user fields (`<name>5__N`) paired with the
Portable PDB hoisted-scope entry at `N - 1`. Zero-length synthesized slots do not
become user locals. Missing scopes, unsupported conventions/slots, unknown methods
and unbound inspection return `available: false` with an explicit reason and no
locals. Malformed ranges, ambiguous fields and invalid query arguments throw
`SymbolError`. Visual Basic, closure fields and compiler state reconstruction are
not mapped by this capability.

Relevant scope, field, method and body-length facts are snapshotted at load without
copying the whole assembly. The private query index is built on its first use.
`maxHoistedEntries`
bounds metadata/index/expanded local entries (default 100,000; hard maximum
1,000,000) before list expansion; field names are limited to 1,024 UTF-16 units.
The index uses `metadata.list` for field/method ownership, including pointer-table
indirection. Each type's fields are read once; each query scans only that method's
hoisted locals and returns fresh records. Load a new symbol set after changing
symbols; modifying input bytes or returned records, including before the first
query, does not alter lookup results. The lookup retains no borrowed bytes or ASTs.

The naming convention and zero-length slot rule follow the primary Roslyn sources:
[GeneratedNames](https://github.com/dotnet/roslyn/blob/main/src/Compilers/CSharp/Portable/Symbols/Synthesized/GeneratedNames.cs)
and [StateMachineHoistedLocalScope](https://github.com/dotnet/roslyn/blob/main/src/Dependencies/CodeAnalysis.Debugging/StateMachineHoistedLocalScope.cs).

`emitPortablePdb(assembly, { stateMachines })` accepts explicit records
`{ moveNext, kickoff, catchHandlerOffset, awaits }`, where method references are
MethodDef tokens and each await is `{ yieldOffset, resumeOffset, resumeMethod }`.
Omitting both stepping fields keeps the record table-only (including iterator
links). An explicit empty await list emits a stepping record with no awaits;
`catchHandlerOffset` defaults to `-1` for no debugger catch handler.

The writer validates yield/resume offsets against IL instruction boundaries in
the exact supplied assembly and requires a nonnegative catch offset to identify a
catch-clause entry. Missing/bodyless methods, operand offsets, end-of-body offsets,
malformed or over-budget await lists, duplicate pairs and duplicate stepping CDI
are rejected. Each referenced body is decoded once per emission; await validation
is linear in records plus decoded instructions. The `asyncLimits` emission option
bounds aggregate state records (default 10,000), awaits (100,000), unique method
body bytes (8 MiB), and decoded instructions (250,000). Hard maxima are 100,000
state records, 1,000,000 awaits/instructions, and 64 MiB of body bytes. Counts and
body bytes are checked before mapping records or decoding IL; the existing
decoder receives only the remaining aggregate instruction budget. Existing raw CDI
input remains available through `debug.custom` and its existing codec validation.
This API consumes explicit producer data. It does not infer Roslyn states or
stepping offsets from SharpForge's preserved-stack async roles, nor reconstruct
hoisted fields, logical frames or async-iterator state.

`readPortablePdb(bytes).asyncInfo(methodToken)` returns `{ stateMachine, steps }`.
Kickoff and MoveNext aliases return the same `{ moveNext, kickoff }` link and
MoveNext await records (`yieldOffset`, `resumeOffset`, `resumeMethod`). Table-only
iterator links have no await records. An independent stepping record without a
state-machine link remains queryable with `stateMachine: null`; unknown tokens
return `{ stateMachine: null, steps: [] }`.

Async information snapshots only its relevant values while reading and lazily
indexes them on the first query. Input-byte, exposed-table and returned-result
mutations cannot change later queries. `maxAsyncEntries` bounds the aggregate
alias entries, stepping parents and awaits before snapshot allocation (default
100,000; hard maximum 1,000,000). Invalid method references, duplicate stepping
parents and ambiguous aliases throw `SymbolError`. Each lookup costs O(returned
awaits), with fresh state and step records. This API exposes PDB stepping metadata;
it does not infer runtime states or iterator yield positions.

Bound `loadSymbols` results expose `closureInfo(lambdaMethodToken)`. For supported
Roslyn C# generation-zero, nongeneric display classes, it returns `available: true`,
the `containingMethod`, `methodOrdinal`, `lambdaOrdinal`, lambda `syntaxOffset`,
`closureType`, `closureOrdinal`, `closureSyntaxOffset` and `captures` containing
`{ name, fieldToken }`. Syntax offsets retain their raw EnC values; this API does
not convert them to source line/column positions. Method identity uses the
enclosing type plus EnC method ordinal and exact generated lambda/closure ordinals.
It never selects an overloaded method by name alone.

Unknown, missing, inconsistent or unsupported mappings return `available: false`,
an explicit `reason` and no captures. VB, generic or edited display-class naming,
static/this-only lambdas, capture-link traversal and runtime field values are not
supported by this capability. Recognized lambda delegate caches are omitted from
captures; other synthesized capture fields make the result unavailable.
`maxClosureEntries` bounds metadata, EnC records and expanded capture entries
(default 100,000; maximum 1,000,000) before snapshots/index expansion. Names share
the bounded 3,072-byte/1,024-UTF-16-unit metadata scan used by hoisted locals.
Relevant facts are owned at load, the query index is lazy, and results are fresh;
input-byte and returned-record mutations cannot alter subsequent queries.
Naming follows Roslyn's [GeneratedNames](https://github.com/dotnet/roslyn/blob/main/src/Compilers/CSharp/Portable/Symbols/Synthesized/GeneratedNames.cs).
