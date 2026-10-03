# Portable value ABI 1

Status: reference interchange contract, not a replacement for either current VM representation.
Pinned baseline: `7f0ca223d1b9a07725078260020019cfb276c241`; inventory records source hashes.
Type widths follow [ECMA-335 sixth edition (June 2012)](https://ecma-international.org/publications-and-standards/standards/ecma-335/), I.12.1.2. Native-sized values use the negotiated **64-bit** profile, including on Wasm32; addresses are never exchanged.

V1. Integers i8/u8, i16/u16, i32/u32 have their stated bit width. i64/u64 and signed nint use decimal strings in JSON and exact integers in a reader; a JS Number beyond 2^53 is rejected, never rounded. `char` is one unsigned UTF-16 code unit (including a lone surrogate); bool accepts only true/false. Fixtures: scalar-boundaries.

V2. A slot is a little-endian uint64: bits 0..7 are the tag, bits 8..63 payload. Tag IDs, in order 0..16: null, bool, i8, u8, i16, u16, i32, u32, char, f32, i64, u64, nint, f64, decimal, ref, struct. Small signed integers sign-extend through bit 63; other inline payloads zero-extend. The last seven kinds index the extension table, in slot order with no gaps or aliases. This indirection preserves all 64 data bits without pretending a full-width scalar plus tag fits in 64 bits. Fixture: scalar-boundaries.

V3. f32 occupies the low 32 payload bits; round once using round-to-nearest ties-to-even. The only accepted f32 NaN bits are 0x7fc00000. f64 extensions use finite JSON numbers or the exact strings NaN, Infinity, -Infinity, -0. All NaN payloads canonicalize on encoding; readers reject noncanonical binary NaN encodings. Signed zero is preserved for floats. Fixture: nan-payloads, scalar-boundaries.

V4. Decimal is a 96-bit unsigned coefficient (canonical decimal string), scale 0..28 and a sign bit. Scale and negative zero are preserved. No binary floating conversion is permitted. Fixture: scalar-boundaries.

V5. Struct is a value record with a stable type ID and recursively typed fields. Null has tag zero and payload zero; it is distinct from an all-zero default struct. This contract does not assert current VM support for arbitrary structs. Fixture: scalar-boundaries.

V6. Arrays hold at most 1,000,000 typed elements and strings at most 1,000,000 UTF-16 units; references within records may form cycles. Heap identity is separate from slot order. Fixture: empty-array, million-array, identity-and-surrogates.

Container layout: 32-byte header: offset 0 magic uint32 0x42414653 (SFAB), 4 uint16 version=1, 6 uint8 pointer width=64, 7 zero flags, 8 uint32 epoch, 12 uint32 slot count, 16 uint32 handle count, 20 uint32 payload byte count, 24..31 zero. Then slotCount*8 bytes, then a canonical JSON table encoded as UTF-16LE without BOM. Object keys are sorted, no whitespace, with exactly extension and handles keys. UTF-16 JSON escaping preserves unpaired surrogates. Handles retain input order. No trailing bytes, unused extensions, reserved fields or unknown versions are accepted; total buffer limit is 64 MiB. Independent Rust implementations must emit the same bytes, not host pointer layouts.

Public reference API: `encode(envelope): ArrayBuffer`, `decode(buffer): envelope`, `validateEnvelope(envelope)` and `AbiError.code`. Value and handle range/cross-reference constraints are codec checks beyond the JSON schema. Run `node --test planning/contracts/tests/value-abi.test.js`; the top-level a00-01 suite integrates this with the standard test discovery.
