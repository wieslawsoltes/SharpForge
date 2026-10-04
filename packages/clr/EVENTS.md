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
does not emit here. SDK 10.0.201/CoreCLR 10.0.5 captured eight events. The
41-case Event/Property/Field/Method/Buffer scope passes: the first run caught a
wrong collectible-context option in the new unload test, then all seven Event
cases passed after correcting that option. A subsequent cache simplification
passed all 13 affected Event/Property cases. Node 24.21.0 syntax/static checks
pass (2,147/2,143 modules); structure reports 284 existing findings, none in CLR.
All validation ran serially through the limiter.

On a shared Apple M3 Pro/darwin-arm64, final new Event cold indexing/accessor
linking measured median 35.916 µs / p95 89.208 µs; cached identity/accessor queries
measured 0.009438 µs / p95 0.035767 µs. Property control parent/initial/final cold
medians were 54.041/64.083/50.250 µs and p95 146.042/143.167/170.125 µs; cached
medians were 0.010304/0.012904/0.009421 µs and p95 0.035029/0.037025/0.036742 µs.
The root reviewer accepted final cold p95 +24.083 µs (+16.5%) and cached p95
+1.713 ns for the shared accessor capability. One validated-table cache shortcut
was applied. Causality remains uncertain on this shared host; no general speedup
or significance is claimed. Allocations were not measured. Full initial/final
measurements, exact source identities and the identical control fixture hash
are retained in the benchmark JSON.

```sh
node scripts/limited.js node packages/clr/tools/capture-event-definitions.mjs tests/fixtures/clr-event-definitions
node scripts/limited.js node --test --test-concurrency=1 tests/clr-events-*.test.js tests/clr-properties-*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-event-definitions.mjs
```

EventInfo delegate binding, add/remove invocation, BindingFlags and inherited
enumeration, generic substitution and execution remain separate increments.
Source VM, direct CIL and Rust native/Wasm execution are not qualified by this
host metadata API.
