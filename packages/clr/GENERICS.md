# Generic signature substitution

`substituteSignature(ast, options)` replaces ECMA VAR and MVAR nodes in the public
CIL member/local signature AST. `substituteTypeSignature(ast, options)` does the
same for a TypeSpec or constraint type AST. Both return a deeply frozen canonical
AST and leave caller objects unchanged. The services reuse the public
`@sharpforge/cil` encoder and decoder for validation and normalization.

Pass `typeArguments` and/or `methodArguments` as ordered arrays of type ASTs.
An omitted argument scope stays open. Providing a scope makes an out-of-range
slot an `SFCLR012` diagnostic. Substitution is simultaneous: a VAR or MVAR inside
a replacement belongs to the caller's scope and is preserved, even when another
argument list could resolve it. This prevents recursive expansion of a caller's
open arguments, such as substituting `T[]` for `T`.

```js
import { decodeSignature } from '@sharpforge/cil';
import { substituteSignature } from '@sharpforge/clr';

const closed = substituteSignature(decodeSignature(memberSignatureBytes), {
  typeArguments: [{ kind: 'primitive', name: 'string' }, { kind: 'primitive', name: 'int' }],
});
```

The service preserves receiver/header flags, generic arity, vararg sentinel,
custom modifiers, array sizes/lower bounds, and function pointer signatures.
Generic arity describes the original metadata declaration and remains present
after replacing method variables. Field, method, property, local, MethodSpec and
type signatures are supported. Arguments must be valid ordinary type ASTs;
`void`, byref and pinned replacements are rejected. A signature containing such
forms in their valid structural positions, such as a byref parameter or pinned
local wrapping a VAR, is supported.

Metadata tokens are copied verbatim. Callers must supply arguments in the same
token scope, or remap tokens beforehand. This API does not bind types, validate
generic constraints, produce instantiated TypeDesc/MethodDesc objects, perform
variance/assignability checks, or execute methods. These remain separate A04
generic services; no generic-definition caching policy is implied here.
For canonical TypeDesc construction and scoped metadata binding, use the
separate [generic instantiation service](INSTANTIATION.md), which accepts handles
and retains their original module/context ownership.

Traversal is linear in the input plus replacement AST sizes and expanded result
size, with a constant number of codec passes. Defaults are depth 64, 4,096 nodes
and 1,024 arguments per scope. `maxDepth` can be 0–256 and `maxNodes` 1–1,000,000.
One input budget includes all supplied argument trees; another bounds expanded
output, including repeated uses of a shared replacement. Cycles and expansion
overflow fail with `SFCLR007`, invalid configuration with `SFCLR006`, malformed
signatures with `SFCLR012`, and an aborted `signal` with `SFCLR009`. The AST root
counts toward depth/node budgets. Results do not retain caller-owned objects.

`tests/fixtures/clr-substitution/Program.cs` captures raw signatures with SRM and
independently renders closed native reflection types for Dictionary<string,int>
fields, selected methods and its indexer, plus a separate generic-method case.
The capture needs only the installed .NET 10 SDK, uses no package feeds, and
stores signature bytes and expected names rather than a CoreLib image.

```sh
node scripts/limited.js node packages/clr/tools/capture-substitution.mjs artifacts/clr-substitution
node scripts/limited.js node --test --test-concurrency=1 tests/clr-generics-substitution*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-substitution.mjs
```

The captured SDK 10.0.201/CoreCLR 10.0.5 oracle contains 17 member signatures; all
match JavaScript substitution, and all seven focused tests pass on Node 24.21.0.
Static checks pass; the structure check reports 264 existing findings and none
in CLR. Validation ran sequentially through the limiter with one local run slot.

The first implementation has no prior equivalent benchmark. On a shared Apple
M3 Pro/darwin-arm64 with Node 24.21.0, the 17-signature benchmark measured median
3.331 µs and p95 5.380 µs per substitution, including validation and immutable
normalization. Exact allocations were not measured; no speedup is claimed.
The committed JSON records the host and measured percentiles.

This host JavaScript service does not qualify source VM, direct CIL or Rust
native/Wasm generic execution.
