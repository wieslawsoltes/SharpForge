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
| Locals and imports | Lexical scopes, primitive/raw constants, import kinds 1–9 |
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
SHA-1/256/384/512 checksum matches. For example, allowlist an exact HTTPS origin
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
