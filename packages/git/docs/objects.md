# Git object IDs, codecs and compression

These primitives support Git's SHA-1 and SHA-256 object formats. The selected
algorithm governs every object ID embedded in a tree, commit or annotated tag,
as well as the hashes consumed by the database, index and pack layers. An absent
protocol `object-format` capability means SHA-1. A mismatched local/remote format
is an explicit `Unsupported` error; converting an existing repository requires
rewriting references inside its objects and is not an ID-width conversion.

## Public API

| Export | Contract |
| --- | --- |
| `getObjectFormat(algorithm = 'sha1')` | Immutable descriptor with `name`, `oidBytes`, `oidLength`, `zeroOid`, `cryptoName`, and equivalent `rawLength`/`hexLength` fields. |
| `detectObjectFormat(config)` | Read dotted-key configuration or nested objects. `extensions.objectFormat` requires repository format version 1. |
| `advertisedObjectFormat(capabilities)` | Decode a capability iterable, string or `Map`; reject duplicate/unsupported declarations. |
| `assertCompatibleObjectFormat(local, remote)` | Return the shared format or reject the transfer before consuming IDs. |
| `validateObjectId(oid, algorithm, {allowZero})` | Validate full width and hexadecimal spelling, returning lowercase hex. |
| `bytesToHex(bytes)` / `hexToBytes(hex)` | Strict conversion between bytes and hexadecimal. |
| `hashBytes(bytes, {algorithm, subtle, signal, maxBytes})` | Asynchronously return a hex digest. SHA-256 uses WebCrypto when supplied/available; `subtle: null` selects portable code. |
| `hashObject(type, bytes, options)` | Hash canonical `<type> <byte-length>\0<body>` input. Portable engines consume separate chunks; WebCrypto SHA-256 uses a contiguous input. |
| `new IncrementalHash({algorithm, maxBytes, signal})` | `update(bytes)` consumes input without retaining it; `digest('hex'|'bytes')` finalizes. Repeated digests are stable; later updates fail. |
| `serializeObject(type, bytes, options)` / `parseObject(raw, options)` | Encode/decode canonical uncompressed object framing. Parsing returns `{type, data, size}`. |
| `encodeTree(entries, options)` / `decodeTree(bytes, options)` | Encode sorted entries/decode strict tree ordering and the configured object-ID width. |
| `encodeCommit(record, options)` / `decodeCommit(bytes, options)` | Encode/decode commit bodies, repeated parents, continued headers and original message bytes. |
| `encodeTag(record, options)` / `decodeTag(bytes, options)` | Encode/decode annotated tag bodies and signed messages. |
| `formatIdentity(record)` / `parseIdentity(text)` | Explicit identity fields `{name, email, timestamp, timezone}`; time is integer Unix seconds and timezone is `+/-HHMM`. |
| `encodeLooseObject(type, bytes, options)` | Validate semantic content and compress a complete loose-object envelope. |
| `decodeLooseObject(bytes, {oid, algorithm, ...options})` | Decompress, parse, validate and hash content; verify `oid` when supplied; return `{oid, type, data, size}`. |
| `validateObject(type, bytes, options)` | Apply semantic validation without compression or persistence. |
| `deflateZlib(bytes, options)` / `inflateZlib(bytes, options)` | Asynchronous zlib streams; `backend` is `auto`, `native` or `portable`. |
| `inflateZlibSync(bytes, {allowTrailing, ...options})` | Portable decoder returning `{data, bytesRead}`. Use `allowTrailing: true` for concatenated pack entries. |
| `adler32(bytes, seed = 1)` | Standard RFC 1950 checksum; carry the previous result as seed to checksum chunks. |

Byte input accepts `Uint8Array`, `ArrayBuffer` and typed-array/DataView views.
Object payloads, decoded names, digests and parsed raw records are owned byte
arrays. Callers must not mutate input buffers while asynchronous native codecs
are consuming them. Low-level synchronous calls should run in a repository
worker for large inputs; they do not claim to meet a main-thread frame budget.

## Tree entries

Tree entries use `{mode, name, oid}`. Numeric modes are their actual octal bit
values: `0o100644`, `0o100755`, `0o120000`, `0o160000`, and `0o40000`; their canonical
octal string forms are also accepted. Encoding sorts a copy of the entries and
does not reorder the caller's array. Decoding rejects duplicate names, unsorted
entries, noncanonical modes, empty names, slash/NUL bytes, `.` and `..`.

Ordering compares raw filename bytes and an implicit `/` after directory names.
For example, `foo.bar` precedes the tree entry `foo`, as in command-line Git.
Trees are byte-oriented: decoders retain `nameBytes`; invalid UTF-8 has
`name: null`, rather than a replacement-character path that a checkout could
mistake for a different file. A byte-preserving consumer can round-trip these
entries; a UI/filesystem consumer must explicitly handle or reject them.
Checkout policy (reserved names, `.git`, case collisions, drive names and symlink
traversal) belongs to the worktree layer and must be enforced there too.

## Commit and tag fidelity

Decoded commits expose `tree`, `parents`, `author`, `committer`, `encoding`,
`message`, `messageBytes`, `headers`, and `raw`. Annotated tags expose `object`,
`type`, `tag`, optional `tagger`, and the same message/header/raw representation.

Each decoded header is `{key, value, valueBytes, raw}`. Multiline `gpgsig`,
`gpgsig-sha256` and `mergetag` records remain complete, ordered records. Repeated
extension headers remain separate records. Encoding accepts `{key, value}`,
`{name, value}`, or `[key, value]`. A newly created commit has standard core-header
ordering; editing a decoded record preserves unrelated header order and bytes.
Header continuation spaces are reconstructed exactly from `valueBytes`.

Unchanged message bytes retain their original encoding, line endings and final
newline. The encoding header controls text decoding; unsupported text encodings
yield `message: null` while retaining `messageBytes`. Modified non-UTF-8 messages
require explicit `messageBytes`, preventing UTF-8 data from being mislabeled as
another encoding. Unknown extension headers are retained. The codec does not
assert that an existing signature remains valid after a caller changes a signed
payload: signing and verification belong to the caller's signing operation.

## Collision-detecting SHA-1

SHA-1 always runs the portable collision-detecting engine, including when
WebCrypto offers ordinary SHA-1. It ports Marc Stevens and Dan Shumow's
MIT-licensed `sha1collisiondetection` implementation. The implementation includes
all 32 disturbance vectors and all unavoidable-bit-condition filters in the
upstream table. Candidate blocks undergo backward and forward SHA-1
recompression from the selected intermediate state; their complete final
chaining values must match before a collision is reported. Matching a PDF
fingerprint or a short byte pattern is not used as collision detection.

On detection, hashing throws `GitError('Unsafe', ..., {algorithm: 'sha1',
collision: true})`. The context becomes unusable and never returns a digest for
the rejected message. The engine does not emit SHA1DC's alternate “safe hash”,
which would be a different Git object ID. This is the upstream detector's
documented disturbance-vector coverage, not a claim that all conceivable SHA-1
collisions can be detected.

Source provenance:

- [Upstream repository and algorithm description](https://github.com/git/sha1collisiondetection).
- `lib/ubc_check.c`, upstream Git blob `b3beff2afbae0e3ca338bedf20c8b16806fe53ac`.
- `lib/sha1.c`, upstream Git blob `3dff80ac727aa00ac8208e4740adf7e80f743bad`.
- The full license is shipped as `src/hash/SHA1DC-LICENSE.txt`.
- Disturbance-vector schedules are expanded from their first 16 words using
  SHA-1's linear expansion. UBC uint32 shifts use JavaScript's unsigned `>>>`.
- Hash tests include the first 320 bytes of both upstream SHAttered fixtures;
  ordinary SHA-1 collides for these prefixes while the detector rejects both.

## Compression and limits

The portable writer imports `deflateRaw` through the existing
`@sharpforge/archive` public entry point. That encoder already supplies real
32 KiB-window LZ77 matching and fixed-Huffman DEFLATE. The zlib layer adds the
RFC 1950 header and Adler-32. No new runtime dependency is introduced.

The archive inflater requires the expected expanded size and complete compressed
input. Git pack entries instead provide a zlib stream followed immediately by
another object, with no compressed length. The Git-specific decoder therefore
supplies unknown-size, bounded expansion and an exact consumed-byte count. It
accepts stored, fixed and dynamic blocks, validates Huffman alphabets and
back-reference distances, and checks zlib framing and checksums.

| Resource | Default |
| --- | --- |
| Expanded zlib output / complete loose-object envelope | 64 MiB, hard maximum |
| Compressed input | `ceil(64 MiB * 9 / 8) + 1024` bytes |
| DEFLATE blocks | 1,000,000 |
| Object header block | 1 MiB |
| Header count | 4,096 |
| Tree entries | 1,000,000, also constrained by object bytes |
| Tree filename bytes | 4,096 |

`maxObjectBytes` bounds the complete loose envelope for compressed operations;
the header consumes part of that allowance. Structural raw-object operations
bound their payload separately. Unsupported preset zlib dictionaries fail
explicitly. Truncated synchronous input is `Corrupt` with
`details.truncated === true`; malformed symbols/checksums are `Corrupt` without
that marker. This lets a streaming pack reader retry only incomplete input.
Resource excess is `Limit`; cancellation is `Cancelled`.

## Verification scope

Focused tests cover padding/chunk boundaries, pure-JS and WebCrypto hashing,
SHAttered collision rejection, malformed trees and headers, legacy message
encodings, native/reference compression and resource bounds. The native Git
fixture test produces 200 objects across SHA-1/SHA-256 repositories, checks
byte-identical typed-codec round-trips, reads objects written by Git, replaces
those objects with the portable writer's output, and verifies them with
`git cat-file` and `git fsck --strict`. The test records the reference Git version.
These tests are staged for the completed Project 19 scope; performance claims
and platform pass claims must come from actual subsequent validation results.

References: [Git object format transition](https://git-scm.com/docs/hash-function-transition),
[Git pack format](https://git-scm.com/docs/gitformat-pack),
[RFC 1950](https://www.rfc-editor.org/rfc/rfc1950),
[RFC 1951](https://www.rfc-editor.org/rfc/rfc1951),
[FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final).
