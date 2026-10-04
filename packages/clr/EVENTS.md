# Event metadata identities

`RuntimeModule.eventDefinition(token)` returns a canonical frozen `EventDesc`.
`eventDefinitions(typeToken)` returns a frozen declared-event array in EventMap
order, honoring uncompressed EventPtr indirection. Descriptors expose `name`, raw
`flags`, `metadataToken`, `declaringType`, `module`, `assembly` and `loadContext`.
The raw `eventTypeToken` is a module-relative TypeDef, TypeRef or TypeSpec token;
nil is preserved as zero. Non-nil coded indices and row extents are validated,
but type resolution, TypeSpec decoding and delegate compatibility are deferred.

Lazy `addMethod`, `removeMethod`, `raiseMethod` and frozen `otherMethods` link to
canonical MethodDesc objects. `module.eventAccessors(token)` returns the same
cached record. Add and remove are required; absent raise is `null`, and Other
may be empty. Invalid roles, method/association tokens, duplicate methods or
single roles, and mismatched declaring types produce `SFCLR005`. These links
read no method signature or executable body. Accessor naming, accessibility and
signature conventions are not checked by this raw metadata service; see
[ECMA-335 II.22.13 and II.22.28](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).

Property and Event share one module-owned MethodSemantics scan, with validation
cached separately for each owner kind. Invalid Event roles do not invalidate
Property-only queries. Per-member accessor records and empty arrays are frozen
and memoized. The shared member index traverses
O(TypeDef + EventMap + Event + EventPtr) rows, bounded to 100,000 combined rows.
Duplicate map owners/list starts and unowned events are rejected. Accessor
indexing bounds MethodSemantics + the queried member table to 100,000 rows.
Event names have a 4,096-byte UTF-8 ceiling checked before decoding. Limit
failures produce `SFCLR007`; all services are synchronous and introduce no
asynchronous cancellation operation. Retained descriptors remain usable during
cooperative unloading, while the context rejects new loads.

The independent C# fixture covers overridden, static, generic, protected,
explicit-interface, interface and struct events. Authored metadata covers
raise/Other links, nil event types, EventPtr order and malformed/oversized rows.
The native fixture does not independently qualify raise/Other links, which C#
does not emit here. Validation is pending its scheduled serial slot.

```sh
node scripts/limited.js node packages/clr/tools/capture-event-definitions.mjs tests/fixtures/clr-event-definitions
node scripts/limited.js node --test --test-concurrency=1 tests/clr-events-*.test.js tests/clr-properties-*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-event-definitions.mjs
```

EventInfo delegate binding, add/remove invocation, BindingFlags and inherited
enumeration, generic substitution and execution remain separate increments.
Source VM, direct CIL and Rust native/Wasm execution are not qualified by this
host metadata API.
