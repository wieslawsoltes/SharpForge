# Canonical nominal categories

`input.js` constructs real CLI metadata rows for synthetic authority contract
tests. Deliberately non-platform names demonstrate that spelling supplies no
category authority. These malformed/boundary graphs are not native-loadability
claims.

`Program.cs` independently reports CoreCLR categories for Object, ValueType,
Enum, String, Int32, DayOfWeek and IDisposable, plus ordinary local classes,
nested classes, an interface, a struct and an enum. It reports actual metadata
root tokens and input TypeRef bindings into `typeof(object).Module`.
`capture.mjs` uses the repository-pinned Roslyn/CoreCLR toolchain, reads that
actual CoreLib PE and first constructs its complete `AssemblyInspector`.

The retained capture records source/compiler/reference hashes, input assembly,
native output, the actual core PE SHA256/size/MVID and a compressed exact metadata
projection. This projection retains original rows/tokens for tables 0, 1, 2, 9,
26, 27, 35, 41 and 42, plus #Strings. It contains all facts consumed by the type
adapter; it is not a generated replacement core library. Both the full inspector
and the owned projection must agree with native results before capture succeeds.
Offline tests replay the same projection without requiring an installed runtime.

Qualification is pending the serialized validation slot. Generate the capture:

```sh
node scripts/limited.js node tests/fixtures/a03-type-categories/capture.mjs /tmp/type-categories-native.json
```

This batch supplies category authority only. Full #2403 object transfers and
#2405 construction/initialization state remain open. No execution backend is
enabled by this metadata API.
