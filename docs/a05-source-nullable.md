# A05 source Nullable values

The source compiler retains ``System.Nullable`1<T>`` as a closed CLI value type through the image, emitted assembly and canonical reload. Its payload uses the runtime's existing copied nullable storage.

| Operation | Behavior |
| --- | --- |
| `null`, `default(T?)`, empty fields/statics/array elements | Absent value without a retained payload |
| `T` to `T?`, `new T?(value)` | Copy into the exact underlying value storage |
| `HasValue`, `Value`, `GetValueOrDefault` | Preserve presence; absent `Value` throws `InvalidOperationException` |
| `T?` to another nullable numeric type | Preserve absence, convert a present payload with its checked/unchecked numeric rules |
| Boxing | Absent becomes null; present boxes the underlying type |
| Unboxing | Null becomes absent; a non-null box must have the exact underlying type |
| `ToString` | Calls the underlying override against writable receiver storage; readonly receivers and rvalues use defensive copies |
| Struct payloads | Copy nested value fields while preserving managed reference identity |

Bytecode `NULLABLE` (ID 57) records the closed owner and operation. Stack verification validates the admitted underlying type and operand count. Emission uses actual CLI `initobj`, constructors and instance members with managed receiver addresses. Reload derives the owner and operation from those instructions and requires complete canonical re-emission before source execution.

`tests/a05-source-nullable.test.js` runs scalar boxing, nullable defaults, struct copy isolation and numeric conversions through source execution, reloaded source and direct CIL. Constructor type/arity failures retain compiler diagnostics. Runtime nullable boxing, snapshots and enum compatibility continue to use their existing focused suites.

`tests/a05-nullable-mutable-text.test.js` covers a struct override that mutates a writable nullable payload, defensive copies for `in` and temporary receivers, absent values, and canonical Boolean, character and unsigned formatting through all three routes. It also captures a suspended override and replays local and portable snapshots after the original frames are retired. The same receiver and primitive cases are retained in `tests/fixtures/a05/nullable/Program.cs` for the native comparison command `node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05/nullable`. These added cases require a new run; an older fixture report does not qualify the changed source or expected trace.

Lifted arithmetic and nullable pattern lowering retain their separately reported compiler capability diagnostics. This change implements the value storage and boxing requirements of A05 #1366; it does not claim those additional language features are newly executable.
