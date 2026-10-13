# @sharpforge/archive

Dependency-free, bounded standard ZIP reading/writing and byte-preserving workspace file codecs for browsers and Node. MIT. Version 0.11.0.

```js
import {writeZip, readZip, decodeWorkspaceFile, encodeWorkspaceFile} from '@sharpforge/archive';
const zip = writeZip([
  {path: 'Program.cs', text: 'Console.WriteLine(42);\n'},
  {path: 'Assets/data.bin', bytes: new Uint8Array([0, 255, 128])},
  {path: 'Empty', directory: true}
]);
const entries = readZip(zip); // complete validation and CRC checking before any records return
```

`readZip(bytes, options)` accepts standard single-disk stored or raw-DEFLATE entries, optional data descriptors, UTF-8, CP437 and validated Unicode path fields. `writeZip(entries, options)` sorts portable paths and writes deterministic UTF-8 **stored** entries; it does not compress output. Directories are explicit records. APIs perform no filesystem writes and no script execution.

Default limits: 20,000 entries, 64 MiB per file, 128 MiB total expanded bytes, 160 MiB archive, 1,024 path characters, 48 path components. Override integer fields in `ZIP_LIMITS` only when the embedding host can afford the corresponding memory. These are input bounds, not a hard JavaScript heap limit.

Rejects absolute/traversing/reserved paths, links/special files, ambiguous case or Unicode identities (including implicit parents), CRC mismatch, overlapping entries, inconsistent headers, encryption, ZIP64, unsupported methods and multi-disk files. It is not a general TAR/7z/RAR reader or a security sandbox for subsequent execution of extracted programs.

## File encoding and path identity

`decodeWorkspaceFile(path, bytes)` retains a copy of the original bytes, recognizes UTF-8 and UTF-16 in either byte order, and records the BOM, each line delimiter and final-newline status. BOM-less UTF-16 is inferred only from a bounded zero-byte pattern. Unsupported text remains binary; failed UTF-8 can use an explicitly flagged Windows-1252 fallback (`lossy: true`), disabled with `{legacyFallback: false}`.

`encodeWorkspaceFile(record)` returns identical bytes for untouched text or binary files. Edited text keeps its encoding and per-line delimiters; set `preserveLineEndings: false` to choose the supplied delimiters deliberately. Unsupported characters in Windows-1252 fail with `SFWENC002`, and malformed UTF-16 strings fail with `SFWENC003`. `isWorkspaceTextPath` and `detectLineEndings` expose the same policies to hosts.

`portablePath` rejects absolute paths, traversal, reserved Windows names, controls and ambiguous separators. `PathPolicy` keeps the stored spelling separate from identity: configure `caseSensitive` and `unicodeNormalization` (`NFC`, `NFD`, or `none`) explicitly. It exposes `normalize`, `identity`, `equals`, `contains` and `compare`; `pathIdentity`, `samePath`, `isWithinPath` and `comparePaths` provide functional equivalents. The project-system package re-exports those policies while keeping its existing relative-reference `normalizePath` behavior.

Focused validation: `node scripts/limited.js node --test tests/a24-path-encoding.test.js tests/workspace-io.test.js`. These are Node byte/path tests; operating-system picker behavior is qualified separately.

`inflateRaw` / `deflateStored` are also exported for Portable PDB embedding. Portable PDBs and workspace ZIPs share the same bounded internal codec.

`deflateRaw(bytes, { maxBytes, maxChain, signal })` emits deterministic raw RFC 1951
fixed-Huffman DEFLATE with a 32 KiB LZ77 window. The default input cap is 64 MiB
and the default search cap is 16 candidates per position (allowed range 1–64).
Scratch tables use 384 KiB; output capacity is at most `ceil(input.length * 9 / 8) + 6`
bytes, plus the returned output copy. Invalid input/budgets fail before those
allocations. AbortSignal cancellation is checked before starting and every 4 KiB.
This synchronous codec is intended for bounded payloads or worker use; it does
not implement streaming ZIP, dynamic Huffman blocks, or a CompressionStream path.
Those remain tracked by SF-A24-T06.3. `writeZip` continues using stored entries.
