# @sharpforge/cil

Genuine ECMA-335 PE/CLI emission, typed CIL lowering, bounded metadata/IL loading, canonical-profile verification and disassembly. JavaScript ESM. Version 0.6.0. MIT. Only sibling dependency: `@sharpforge/bytecode`.

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
its existing `sha256` export as a reexport of this function; SHA-1 remains in the symbols package.
Hashing reads complete 64-byte blocks directly from the input. Padding uses at most 128 bytes,
with one reusable 256-byte schedule and 32-byte state, so scratch storage is independent of input size.

Embedded data emission and bounded inspection are documented in [RESOURCES.md](./RESOURCES.md).

Win32 version, manifest and ICO emission is documented in [WIN32-RESOURCES.md](./WIN32-RESOURCES.md).
