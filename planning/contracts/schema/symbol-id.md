# Symbol identity v1

Namespace/type/member IDs follow documentation-comment conventions: N:namespace, T:qualified type (backtick arity), M:owner.method(parameters), F:owner.field, P:owner.property(parameters), E:owner.event. Method arity uses double backtick. Explicit interface member dots become #. Parameter spellings must be canonical CLI/documentation type spellings; return types participate only for conversions, which are not yet supported by this reference adapter.

Locals, lambdas and local functions use X:kind:escaped-parent:escaped-document:ordinal:escaped-name. Percent escaping includes dots; ordinals are lexical declaration order within parent and document. They survive recompilation only when that declaration ordering is stable; source movement/edit-and-continue remapping is a separate protocol.

`SymbolTable` maps identities to declarations and (module identity, metadata token) pairs back to IDs. Tokens alone are module-local and may be reassigned by emit; callers must include module identity. Duplicate IDs/tokens and unresolved queries fail closed. Golden symbols cover overloads, generics, explicit interface members, locals, lambdas and local functions. The table does not claim to reconstruct a declaration from the textual ID without a symbol index.
