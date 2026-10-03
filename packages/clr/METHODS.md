# Method definition identities

`RuntimeModule.methodDefinition(token)` returns a canonical frozen `MethodDesc`
for a MethodDef in that module. `methodDefinitions(typeToken)` returns a frozen
declared-method array in metadata list order, including constructors and private
members. Lists honor uncompressed `#-` MethodPtr indirection. These are metadata
queries; they do not filter BindingFlags or include inherited members.

Descriptors expose `name`, `metadataToken`, `declaringType`, `module`, `assembly`,
`loadContext`, raw `flags`, raw `implementationFlags` and `isStatic`. Identity
lookup reads only ownership rows and names. It does not resolve type references,
decode signatures, build virtual slots or load executable bodies. Repeated
lookups in a module share identity; different loaded modules remain distinct.

The lazy `signature` getter uses the public CIL decoder and caches a deeply frozen
signature AST. A malformed blob, a non-method signature or a receiver/static flag
mismatch produces `SFCLR005` only when the signature is requested. The original
VAR/MVAR slots are preserved. No generic method instantiation is implied.

`method.genericParameters` and `module.methodGenericParameters(methodToken)` add
canonical MethodDef-owned GenericParam descriptors. The shared generic metadata
index supplies names, positions, attributes and raw constraint tokens. A parameter
has `genericParameterOwner` and `declaringMethod` equal to its canonical MethodDesc,
and `declaringType` equal to that method's type. `module.genericParameter(token)`
works for either metadata owner kind. Type-owned parameters have a null
`declaringMethod`. Parameter arrays, including empty arrays, are memoized on each
method. Requesting them lazily validates that the parameter count matches the
method signature's generic arity; mismatches produce `SFCLR012`, while arity over
1,024 produces `SFCLR007`.

The extended generic-parameter fixture captures four methods with four parameters
covering value/reference/default-constructor and dependent/interface constraint
tokens. Its new validation and benchmark evidence are pending a separate slot.
Constraint resolution/enforcement and method instantiation remain unsupported;
these metadata descriptors report `isLoaded: false` and load no executable body.

`getMethodBody()` delegates to the module's existing body cache and returns a
defensive snapshot, including copied IL bytes. A zero RVA returns `null`.
`module.methodBodyReadCount` remains zero until a body is actually decoded and
increments only once per method. Holding a descriptor retains its module and
assembly, consistent with existing collectible metadata lifetimes.

The first lookup indexes MethodList ownership in O(TypeDef + MethodDef + MethodPtr)
rows, bounded to 100,000 combined rows. The module owns all caches, and repeated
identity/signature reads use indexed lookups. Names are bounded to 4,096
characters; signature decoding uses the existing CIL depth/node limits. Invalid
or duplicate ownership, unowned methods and invalid tokens produce `SFCLR005`;
row/name limits produce `SFCLR007`. This synchronous metadata service introduces
no cancellable asynchronous operation.

The native fixture in `tests/fixtures/clr-method-definitions/Program.cs` records
CoreCLR reflection attributes, owner tokens, signatures and raw method IL for
interfaces, abstract and overridden methods, overloads, constructors, and generic
type/method variables. The accompanying metadata fixtures cover lazy errors,
pointer-table ownership and defensive body copies.

```sh
node scripts/limited.js node packages/clr/tools/capture-method-definitions.mjs artifacts/clr-method-definitions
node scripts/limited.js node --test --test-concurrency=1 tests/clr-methods-*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-method-definitions.mjs
```

Validation is pending the scheduled serial slot. Full MethodInfo/ConstructorInfo
and ParameterInfo facades, defaults, GetBaseDefinition, overload resolution,
virtual dispatch and invocation are
separate increments. Source VM, direct CIL and Rust native/Wasm execution are
not qualified by this host metadata API.
