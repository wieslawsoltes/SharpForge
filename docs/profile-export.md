# Instruction profile export (SF-A05-T10.3, #1404)

`exportSpeedscope(profile, {name})`, exported by `@sharpforge/runtime`, converts a
`SharpForge.InstructionProfile/1` object, or a profiler exposing `read()`, into
owned JSON data for Speedscope. The input clock must be `instructions`.
The exporter maps each method ID to a shared frame, preserving method names,
recursive stack occurrences, and capacity-overflow samples. Method IDs need not
equal array indices. Sample weights must be nonnegative safe integers whose sum
exactly equals the profile's recorded instruction count. Malformed IDs, duplicate
IDs, missing methods, unsafe counts, wrong formats/clocks and inconsistent totals
throw `TypeError` rather than producing a misleading profile.

The output follows the [official Speedscope JSON schema](https://www.speedscope.app/file-format-schema.json):
one sampled profile with `unit: "none"`, `startValue: 0` and `endValue` equal to
the recorded instruction total. Samples are aggregated work counts, not a
chronological execution timeline or CPU/wall-clock duration. Output arrays and
frame records do not alias the input. Empty profiles are supported. The exporter
reads a supplied profiler once and installs no observers or VM hooks. Export work
and output size are linear in methods plus recorded stack entries.

The instruction-profiler dependency is included in this branch. Run:

```sh
node examples/runtime/profile.mjs cil > profile.speedscope.json
node examples/runtime/profile.mjs source > source.speedscope.json
node examples/runtime/profile.mjs reload > reload.speedscope.json
```

Open the JSON in [Speedscope](https://www.speedscope.app/). Program output is sent
to stderr; stdout contains only the profile. For allocation and call counters,
save `vm.profiler.read()` directly. This increment does not associate the separate
runtime event stream with profiler samples and does not export EventPipe or binary
`.nettrace` data. That part of #1404 remains open, as do Studio view integration
and browser qualification.

| Capability | Source / reload | Direct CIL | Qualification |
| --- | --- | --- | --- |
| Instruction-weighted Speedscope JSON | Implemented | Implemented | Focused Node 24.21.0 tests passed |
| Empty, recursive and capacity-overflow profiles | Supported input shapes | Supported input shapes | Focused tests passed |
| Duration or `.nettrace` output | Not provided | Not provided | Separate work required |

The schema fixture is an unmodified copy retrieved from the official URL on
2026-10-04. Tests exercise its required JSON shape as well as method/weight
semantics, invalid inputs, ownership, and real profiles from all three engines.
All 28 focused tests passed serially with Node 24.21.0 at `4314866a`:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-10-profile-export.test.js
```

Speedscope application loading, browser qualification and performance measurements
remain queued for the completed scope.
