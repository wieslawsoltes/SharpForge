# Property index parameters

`PropertyDesc.indexParameters` and `RuntimeModule.propertyParameters(token)`
return the same canonical frozen ParameterDesc array. A getter, including a
nonpublic getter, supplies the parameter metadata. Without a getter, the setter
supplies all parameters except its final value parameter. No accessor gives an
empty array. The same getter-first projection is used by
[CoreCLR v10.0.5 RuntimePropertyInfo](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/System.Private.CoreLib/src/System/Reflection/RuntimePropertyInfo.cs).

A projected parameter's `member` is the property; `method` remains its defining
accessor. Name, position, flags, Param token and frozen `signatureType` come from
the accessor ParameterDesc. The projection has distinct identity from that
method parameter. Its lazy `constant` shares the source's immutable raw ECMA
Constant result. Omitted Param rows preserve this API's explicit zero token and
null name; real rows preserve their tokens and can have empty names. Plain
method and return parameters now expose `member` equal to `method`.

This is raw accessor metadata. Type resolution, generic substitution, property
versus accessor signature compatibility, property-signature custom modifier
reflection, attribute-based defaults and invocation are separate services.
No getter/setter signature is read before requesting index parameters, and the
unselected setter's signature is not decoded when a getter exists. No executable
body is loaded. The chosen accessor's existing signature, Param ownership, name
and Constant limits/diagnostics apply. A setter lacking its required value
parameter produces `SFCLR005`.

Projection visits each selected parameter once and retains at most 100,000
additional descriptors per module, including aliases of the same accessor.
Overflow is checked before the projection array is allocated (`SFCLR007`).
Arrays, including empty results, and per-property descriptor identities are
memoized. Retained metadata remains usable during cooperative unload; this
synchronous operation introduces no asynchronous cancellation point.

Authored tests cover getter preference, write-only projection, omitted rows,
ParamPtr order, malformed lazy data, limits and unload. The independent C#
fixture covers defaults, a nonpublic getter, generic and array index types,
write-only/ordinary properties and interface indexers. Native capture, focused
tests and measurements are pending the assigned serial validation slot.

```sh
node scripts/limited.js node packages/clr/tools/capture-property-parameters.mjs tests/fixtures/clr-property-parameters
node scripts/limited.js node --test --test-concurrency=1 tests/clr-properties-*.test.js tests/clr-methods-*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-property-parameters.mjs
```

Full PropertyInfo binding/value access, inherited-member views and source VM,
direct CIL or Rust native/Wasm execution are not qualified by this metadata API.
