# @sharpforge/archive

Dependency-free ZIP/ZIP64 codecs, bounded streaming, compression, and portable workspace file encoding.

```js
import { writeZip, readZip, openZip, writeZipTo } from '@sharpforge/archive';

const bytes = writeZip([{ path: 'Program.cs', text: 'Console.WriteLine(42);\n' }], {
  compression: 'deflate', level: 'default', forceZip64: true
});
const files = readZip(bytes);
const archive = await openZip(new Blob([bytes]));
try {
  await archive.stream('Program.cs').pipeTo(destinationWritableStream);
} finally {
  archive.close();
}

await writeZipTo([{ path: 'large.bin', stream: sourceReadableStream }], destinationWritableStream, {
  maxFileBytes: 8 * 1024 ** 3,
  maxTotalBytes: 16 * 1024 ** 3,
  maxArchiveBytes: 20 * 1024 ** 3,
  compression: 'deflate',
  signal
});
```

## Capability inventory

| API / capability | Implemented behavior | Qualification boundary |
| --- | --- | --- |
| `readZip`, `writeZip` | STORED and DEFLATE; automatic ZIP64 count/size/offset records; optional forced ZIP64 | Entire archive/result resides in memory; allocation limits of the JS engine still apply |
| `deflateRaw` | Existing fixed Huffman/LZ77 compressor | Portable JS; explicit search budget |
| `deflateDynamic` | Dynamic Huffman blocks, 32 KiB dictionary and bounded block tokens | Portable JS; fixed fallback for an excessive Huffman depth |
| `compressDeflate` | Explicit portable or `CompressionStream` backend, returned with output | Platform backend must be available; no implicit network/service |
| `openZip(Blob)` | Tail and central-directory reads; lazy per-entry payload access | Central directory is bounded by `maxCentralBytes`; metadata retains one descriptor per entry |
| `ZipArchive.stream` / `chunks` | Incremental DEFLATE with 32 KiB history, CRC on completion and cancellation | Bytes are provisional until the stream completes successfully; use staging for untrusted extraction |
| `writeZipTo` | Backpressure, incremental CRC, signed data descriptors and ZIP64 | Async iterable order is retained; arrays are sorted; portable streaming compression uses fixed Huffman blocks |
| Metadata | `preserveMetadata: true` retains UTC `mtime` in milliseconds (whole seconds), regular Unix permission bits | Default timestamps/modes are deterministic; links/special files and multi-disk archives are rejected |
| File codecs | BOM/encoding/line-ending and binary preservation, explicit `PathPolicy` identity | See public encoding diagnostics; paths are root-relative and portable |

## Workspace text policy

Use `isWorkspaceTextPath(path)` to share file-type recognition across ZIP imports, folder providers, and native editing.
Recognition is case-insensitive and includes `.xaml`, `.manifest`, `.appxmanifest`, and `.pubxml` alongside the existing
code, project, and configuration formats. `decodeWorkspaceFile` still rejects binary contents for recognized suffixes;
recognition alone never forces a binary file into a text editor. The returned records retain their original bytes,
encoding, BOM, and line endings. Pass those records to `encodeWorkspaceFile` to preserve unchanged bytes exactly and
retain the original encoding when editing text.

## Archive limits and streaming

`ZIP_LIMITS` defaults to 20,000 entries, 64 MiB per file, 128 MiB decoded total, 160 MiB archive, 32 MiB central directory, depth 48, path length 1024, and per-file/total compression ratios of 1000. Limits accept positive safe integers; streaming callers can raise byte/count limits deliberately. The 64 KiB default chunk can be configured up to 4 MiB. All decoded-size, directory, count, ratio and overlap budgets are checked before large output allocations. CRC failure, mismatched headers, encrypted entries, unsupported methods, traversal, case/Unicode aliases, overlapping ranges and malformed ZIP64 records produce explicit errors (`SFZIP001`–`SFZIP014`). Archives embedded as ordinary file bytes are never recursively extracted.

An entry reproducing the exact enclosing ZIP bytes is rejected as a direct quine (`SFZIP014`). Streaming comparison
uses one bounded chunk only when declared sizes match; normal entries need no extra payload reads. By default, ordinary
nested archive bytes are preserved. `{nestedArchives:'reject'}` also rejects embedded ZIP local/empty/ZIP64 signatures
before returning their contents; it never opens or inflates the nested archive. This signature policy is deliberately
not a general polyglot detector. Size/ratio budgets remain the protection for every outer payload, regardless of its name.

`openZip` lists even sparse multi-gigabyte archives without reading the payload. `read(path)` deliberately materializes one entry; use `stream` or `chunks` for large entries. `close()` cancels active readers. Writer cancellation aborts its sink; rollback of external destinations belongs to the destination transaction API.

Once a streaming writer accepts its destination, validation and payload failures abort that destination and release
any acquired writer. A stream already locked by another writer is rejected without aborting or releasing that owner.

Run `node packages/archive/examples/streaming.mjs` for a complete example. Focused regressions: `tests/a24-06-archives.test.js`, `tests/a24-06-archive-large-metadata.test.js`. Reference fixtures use Node zlib and Python's standard `zipfile`; they do not establish File System Access or native OS qualification.

The monorepo benchmark `node packages/project-system/examples/archive-benchmark.mjs --baseline=<git-revision>` measures warm median/p95 stored read/write times and exports a 500 MiB workspace from 64 KiB producers. It records writer memory separately from the later `readZip` materialization, then checks the result with Python `zipfile`. Run it once per completed archive scope on an otherwise idle machine when collecting performance evidence.
