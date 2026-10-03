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

`decodeWorkspaceFile(path, bytes)` preserves original bytes, detects supported text extensions and UTF-8/UTF-16 BOMs, and otherwise leaves binary data untouched. `encodeWorkspaceFile(record)` retains unedited bytes and re-encodes edited text in the original supported encoding. No newline normalization occurs. Invalid text, including a binary `.cs` file, remains binary rather than being silently discarded.

`inflateRaw` / `deflateStored` are also exported for Portable PDB embedding. Portable PDBs and workspace ZIPs share the same bounded internal codec.
