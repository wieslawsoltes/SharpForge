# Unnamed and optimized local slots

Implementation and capture sources are prepared; no validation or native build
has run for this batch. This fixture will use a Release/Optimize=true Roslyn
build. CLR `MethodBody.LocalVariables` supplies declared slots/types and SRM
supplies exact LocalVariable names, flags and scope ranges. The loop deliberately
requires unnamed iteration storage; an eliminated source local is not restored.
The authored suite separately covers no-scope methods, reused and hidden slots,
missing metadata, ownership, malformed tokens/headers, bounds and cancellation.

The CIL header-only seam shares parsing with `readMethodBody`, preserving the
body result while avoiding irrelevant IL/EH allocations for slot enumeration.
No runtime values or optimized source-variable reconstruction are supported.
Existing Debug fixtures remain compatibility controls; their native evidence is
reused rather than rebuilt. One new Release fixture capture is required to meet
#2539; all execution and performance validation awaits the sole scheduled slot.

```sh
node scripts/limited.js node scripts/validate-pdb-unnamed-slots.mjs --capture tests/fixtures/portable-pdb-unnamed-slots
node scripts/limited.js node --test --test-concurrency=1 tests/a13-04-unnamed-slots.test.js
```

The shared scope/import/annotation/local-slot browser qualification batch is
separate and pending; this draft makes no browser or native pass claim.
