# Speedscope profile export (SF-A05-T10.3, #1404)

`exportSpeedscope(profile, {name, metric})`, exported by `@sharpforge/runtime`, converts a
`SharpForge.InstructionProfile/1` object, or a profiler exposing `read()`, into
owned JSON data for Speedscope. The input clock must be `instructions`.
The default `metric: 'instructions'` preserves the existing instruction export.
The exporter maps each method ID to a shared frame, preserving method names,
recursive stack occurrences, and capacity-overflow samples. Method IDs need not
equal array indices. Sample weights must be nonnegative safe integers whose sum
exactly equals the profile's recorded instruction count. Malformed IDs, duplicate
IDs, missing methods, unsafe counts, wrong formats/clocks and inconsistent totals
throw `TypeError` rather than producing a misleading profile.

The instruction output follows the [official Speedscope JSON schema](https://www.speedscope.app/file-format-schema.json):
one sampled profile with `unit: "none"`, `startValue: 0` and `endValue` equal to
the recorded instruction total. Samples are aggregated work counts, not a
chronological execution timeline or CPU/wall-clock duration. Output arrays and
frame records do not alias the input. Empty profiles are supported. The exporter
reads a supplied profiler once and installs no observers or VM hooks. Export work
and output size are linear in methods plus recorded stack entries.

Select `metric: 'duration'` to export already captured elapsed milliseconds from
the [opt-in duration profiler](profiler-duration.md). The profile must contain
`duration.enabled: true`, `clock: 'monotonic'`, `unit: 'milliseconds'`, a finite
nonnegative `totalMilliseconds`, and a nonnegative safe-integer interval count.
Every sample must have a finite nonnegative `milliseconds` value. Missing,
disabled or malformed timing data is an error; instruction counts are never
converted into elapsed time. An enabled empty capture can export a zero range,
and measured zero-duration intervals are supported. A profile with no captured
intervals cannot claim elapsed time or executed samples.

Duration output uses `unit: 'milliseconds'`, the captured `totalMilliseconds` as
`endValue`, and each sample's captured milliseconds as its weight. Method names,
recursive occurrences and capacity-overflow samples retain the same mapping as
instruction export. Both metrics still require exact instruction-count totals.
Grouping elapsed intervals by stack can change floating-point addition order,
so duration totals allow relative roundoff up to
`min(4 * Number.EPSILON * (intervals + samples.length + 1), 1e-9)`.
Zero and nonzero totals never compare equal under this tolerance. Non-finite
sums and material discrepancies are rejected. The exporter preserves the
captured weights and total rather than adjusting them to agree. These are
sampled elapsed durations, not CPU time or a chronological event timeline.
The default instruction export ignores optional duration data, even if that
unused data is malformed.

The instruction-profiler dependency is included in this branch. Run:

```sh
node examples/runtime/profile.mjs cil > profile.speedscope.json
node examples/runtime/profile.mjs source > source.speedscope.json
node examples/runtime/profile.mjs reload > reload.speedscope.json
node examples/runtime/profile.mjs cil duration > elapsed.speedscope.json
```

Open the JSON in [Speedscope](https://www.speedscope.app/). Program output is sent
to stderr; stdout contains only the profile. For allocation and call counters,
save `vm.profiler.read()` directly. This increment does not associate the separate
runtime event stream with profiler samples and does not export EventPipe or binary
`.nettrace` data. Runtime trace JSON remains separate work, as do Studio view integration
and browser qualification.

| Capability | Source / reload | Direct CIL | Qualification |
| --- | --- | --- | --- |
| Instruction-weighted Speedscope JSON | Implemented | Implemented | Focused Node 24.21.0 tests passed |
| Empty, recursive and capacity-overflow profiles | Supported input shapes | Supported input shapes | Focused tests passed |
| Captured elapsed-millisecond Speedscope JSON | Implemented | Implemented | New focused cases authored; validation pending |
| Runtime trace JSON / binary `.nettrace` output | Not provided | Not provided | Separate work / binary format unsupported |

The schema fixture is an unmodified copy retrieved from the official URL on
2026-10-04. Tests exercise its required JSON shape as well as method/weight
semantics, invalid inputs, ownership, and real profiles from all three engines.
All 28 focused tests passed serially with Node 24.21.0 at `4314866a`:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-10-profile-export.test.js
```

Speedscope application loading, browser qualification and performance measurements
remain queued for the completed scope.

`tests/a05-duration-profile-export.test.js` adds captured-duration schema cases,
rounding, zero/extreme boundaries, malformed/missing timing data, ownership and
source/reload/direct-CIL fixtures with an injected clock. It shares the existing
pinned-schema assertions with the instruction tests. These new cases have not
been executed; the 28-test evidence above applies only to the earlier instruction
export. No measured performance or browser import result is claimed for duration
export.
