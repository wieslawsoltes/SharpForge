# Prepared CIL core type authority

`prepareVerificationCoreTypes(inputModule, options)` asynchronously prepares the
`coreTypes` option consumed by CIL's metadata verification factories. It reuses
the load context's existing `TypeLoader`; it neither implements a second
resolver nor changes local CIL identities.

The host supplies `coreModule`, its already prepared CIL `context`, and the
context's canonical `object`, `valueType`, and `enum` handles. This pairing and
these roles are explicit trusted inputs. Equal names, assembly display names,
tokens in different modules, and CLR intrinsic descriptors do not establish
core authority. The helper checks canonical root identity and matching raw
flags, while CIL validates the declared roots' base chain during construction.
The caller remains responsible for creating the context from the declared
core module's image; tokens and flags cannot prove two snapshots' provenance.

`tokens` is an explicit array of input-module TypeDef/TypeRef tokens. Prepare
the relevant external base TypeRefs, plus root TypeDefs when inspecting the
core module itself. The helper validates and owns the complete selection
before awaiting any resolution, using the validated array length and numeric
indices rather than a caller-overridden iterator. `maxBindings` defaults to 4,096 and can range
from zero to 65,535; duplicate input entries count against that limit but are
resolved once. The existing loader separately bounds metadata and traversal.

Each selected token is resolved through the existing async loader. Only a
descriptor whose canonical `module` is exactly `coreModule` maps to that CIL
context's handle. The returned frozen authority contains the context, three
roots, and a synchronous `resolveType(token)` lookup returning frozen records:

- `known` contains the canonical CIL handle, never a CLR `TypeDesc`.
- `outside-core-module` covers other modules and host intrinsics.
- CIL's unsupported-definition reason, such as `generic-definition`, is kept.
- `unprepared-core-binding` covers every token outside the prepared selection.

Unknown results have no token field; the CIL consumer owns the queried input
token and attaches it to its own result. Missing assemblies, malformed metadata,
unsupported loader operations, budget failures and cancellation propagate
unchanged. Failed preparation publishes no authority. `signal` covers
preparation; subsequent synchronous CIL work uses its own cancellation policy.
The map owns its selection and records, retains canonical CIL handles, and
exposes no borrowed PE buffer or metadata row. It does not read method bodies.

```js
const coreTypes = await prepareVerificationCoreTypes(inputModule, {
  coreModule, context: coreContext, object, valueType, enum: enumeration,
  tokens: relevantBaseReferences, signal,
});
const verifier = createMetadataVerificationTypeSystem(inputInspector, { coreTypes, signal });
```

This is a host integration prerequisite for #2403. It does not implement
object/field instruction transfers, cross-module nominal verification,
generic instantiation, forwarding, or execution. It adds no work to existing
loader queries. Authored tests exercise actual CLR module binding and CIL
category construction, canonical module isolation, owned selection, unknowns,
limits and cancellation. Qualification is pending its scheduled serial slot;
this host-specific bridge has no direct CoreCLR reflection counterpart.
