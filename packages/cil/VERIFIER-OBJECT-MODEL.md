# Typed CIL nominal object operations

`verifyCilMethodTypes(bytesOrInspector, methodToken, options)` prepares and verifies
local, nongeneric `newobj`, `castclass`, `isinst`, `box`, `unbox` and `unbox.any`
through the existing transfer registry. These methods report the additive profile
`SharpForge.TypedCIL.Objects/1`; existing numeric, literal, field and primitive
indirect operations compose in the same method. Verification still returns
`verified`, `rejected` or `unknown`. An unavailable authority or unsupported
representation never grants a proof.

## Construction and conversions

| Instruction | Checked contract and stack result |
|---|---|
| `newobj` | Accessible local instance `.ctor` with constructor flags and `void` return; consume declared arguments in reverse order; push the owner's reference or value representation |
| `castclass`, `isinst` | Consume a reference or null; push the declared reference type, or the exact boxed identity for a value type |
| `box` | Consume a value assignable to the declared operand type; push its boxed identity; reference operands preserve their declared reference representation |
| `unbox` | Consume a reference or null; require a value-type operand; push its readonly managed pointer |
| `unbox.any` | Consume a reference or null; push the declared value or reference representation |

Wrong stack kinds and incompatible values reject; invalid token tables/extents,
inaccessible declarations, ordinary methods used as constructors, invalid
constructor flags/returns and abstract construction also reject. Canonical local
TypeRef and MemberRef aliases reuse the same prepared declaration. Boxed identities
cannot be merged into an unrelated exact boxed identity, although ordinary object
and known interface assignment remain available. Readonly unbox addresses support
conditions, compatible pointer comparisons and field reads. They cannot provide a
writable field receiver or a mutable byref argument.

This checks a constructor caller's declared contract. It does not verify the
callee body, prove constructor-this initialization or add general call handling.
Only ordinary local CIL implementations are prepared. Reference construction must
have a cached local base path ending at the explicitly bound, canonical external
Object root, with `coreTypes.sameModule === false`. Other external ancestry,
including delegates even when their constructors are incorrectly marked as IL,
returns `ConstructorBaseUnavailable`. Runtime/PInvoke/native constructors return
`ConstructorImplementationUnavailable`. Constructor-body verification remains
`ConstructorStateUnavailable`; modified returns require later normalization.

Verification does not predict runtime exceptions. For example, a cast between
unrelated reference types and boxing one value type followed by unboxing another
can be verifiable while throwing if executed. Null follows the same verifier
reference rules; this API does not execute or suppress the eventual runtime check.

## Explicit annotation authority

Value-type object operations inspect the module's TypeDef custom attributes.
An optional `options.objectTypeAnnotations` authority classifies the exact
MethodDef/MemberRef constructor tokens used by those attributes:

```js
const objectTypeAnnotations = {
  classifyConstructor(constructorToken) {
    return preparedConstructors.get(constructorToken)
      ?? { status: 'unknown', reason: 'constructor-identity-not-prepared' };
  },
};
// Known entries have the shape:
// { status: 'known', value: { byRefLike: true /* or false */ } }
```

This is a trusted, module-scoped input, separate from `coreTypes`. The host must
prepare deterministic constructor-identity facts for these exact module bytes.
Returning `false` asserts that this actual constructor does not mark a value as
ref-like. A type name, attribute spelling or token copied from another module
cannot establish that fact. The verifier validates the constructor token and
ordinary instance/void signature before consulting the authority. It accepts
only synchronous known/unknown result objects, copies the boolean once and retains
no returned provider object in block states. Unknown reasons must be nonempty
strings of at most 256 characters. Missing, throwing, asynchronous or malformed
providers produce `ObjectAnnotationAuthorityUnavailable` with `unknown` status.

Known harmless annotations permit normal value operations. An authoritative
ref-like annotation rejects `box` with `BoxByRef`. Construction and other object
conversions involving such a value remain unknown with explicit lifetime or
object-conversion reasons. A missing authority cannot erase these restrictions.
A value with no TypeDef custom attributes needs no annotation provider. This is
representation preparation, not global custom-attribute blob validation or a new
assembly/type loader.

| Option | Default and hard ceiling | Charged work |
|---|---:|---|
| `maxObjectAnnotationRows` | 65,535 | All module CustomAttribute rows when value-type object preparation is needed |
| `maxObjectAnnotationBytes` | 1,048,576 | Each distinct referenced attribute-constructor signature blob once |

Zero permits zero charged work. Invalid/exhausted budgets return `CILDF0001` /
unknown. Cancellation before each scanned row, constructor and authority callback,
and after that callback, returns `CILDF0002` / unknown. Attribute signature decode
also uses bounded depth (32) and node count (256). Every invocation rebuilds its
owned preparation facts, so cached inspector decoding cannot bypass changed
authority, budgets or cancellation.

Preparation is O(instructions + scanned attributes + charged signature bytes +
bounded metadata queries). Each distinct annotation constructor is classified
once per invocation, including repeated rows and aliases of an owning type.
Constructor base paths are memoized and use existing type depth/query limits;
the existing core authority validates and snapshots their root identities. This
constructor-only root snapshot does not run for casts or boxing. Transfer handlers
perform bounded stack work using prepared immutable records. They do not call
annotation providers, decode signatures or display token text. Existing metadata,
member, signature, stack and dataflow budgets continue to apply independently.

## Explicit remaining boundaries and evidence

Enums require underlying-storage normalization and return `EnumStorageUnavailable`.
TypeSpecs, arrays, open generics, unresolved external types/members, byref returns,
explicit-layout value objects, constructor-this state and ref-like lifetimes
remain unsupported with explicit unknown results. Nominal indirect memory access
continues to use the existing `MemoryTypeUnavailable` boundary; the primitive
memory policy is unchanged. `ldtoken`, `throw`, general calls and exception-handler
typing remain separate work under #2403/#2405/#52. This typed API does not grant
managed runtime execution admission.

The rules follow [ECMA-335 III.4.1, III.4.3, III.4.6, III.4.21, III.4.32 and III.4.33](https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
The corpus independently emits actual CLI metadata and IL and captures one selected
caller with [ILVerify 10.0.5](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/tools/ILVerification/ILImporter.Verify.cs).
Its [stack helper](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/tools/ILVerification/ILImporter.StackValue.cs)
recognizes only managed-pointer stack kinds in its boxing ref-like check. The
fixture therefore declares the stricter authoritative ref-like boxing policy as
an explicit difference before capture. A separate ref-like return case checks
native lifetime rejection; unsupported results are never counted as agreement.

See the [fixture README](../../tests/fixtures/verifier-object-model/README.md) for
exact capture, focused test, browser API and performance commands. Native capture,
execution and performance results are pending the coordinating serial validation
slot; no pass or performance improvement is claimed here.
