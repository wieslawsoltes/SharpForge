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

Run the integrated exporter examples:

```sh
node examples/runtime/profile.mjs cil > profile.speedscope.json
node examples/runtime/profile.mjs source > source.speedscope.json
node examples/runtime/profile.mjs reload > reload.speedscope.json
node examples/runtime/profile.mjs cil duration > elapsed.speedscope.json
```

Open the JSON in [Speedscope](https://www.speedscope.app/). Program output is sent
to stderr; stdout contains only the profile. For allocation and call counters,
save `vm.profiler.read()` directly. Structured runtime event JSON is provided by
[`exportRuntimeTrace(log, {after, limit})`](runtime-trace-export.md), also exported
by `@sharpforge/runtime`. It exports the existing `SharpForge.RuntimeEvents/1`
event records with instruction counters, sequence cursors and dropped-event
counts. Event export remains independent of profiler samples and duration capture.
Binary EventPipe and `.nettrace` output are unsupported. This API documentation
does not claim Studio view integration or browser qualification.

| Capability | Source / reload | Direct CIL | Qualification |
| --- | --- | --- | --- |
| Instruction-weighted Speedscope JSON | Implemented | Implemented | Historical 28-case focused run at `4314866a`; export cases also passed in the broader run described below |
| Empty, recursive and capacity-overflow profiles | Supported input shapes | Supported input shapes | Schema and ownership regressions in the same exporter suites |
| Captured elapsed-millisecond Speedscope JSON | Implemented | Implemented | Duration-export cases passed within the broader `3b482d83b` run; see its limits below |
| Structured runtime trace JSON | `exportRuntimeTrace` accepts an enabled observer log | Same helper and event format | Bounded-export regressions passed within `3b482d83b`; [event export contract](runtime-trace-export.md) |
| Binary EventPipe / `.nettrace` output | Unsupported | Unsupported | No native trace-tool import compatibility claim |

The schema fixture is an unmodified copy retrieved from the official URL on
2026-10-04. Tests exercise its required JSON shape as well as method/weight
semantics, invalid inputs, ownership, and real profiles from all three engines.
All 28 focused tests passed serially with Node 24.21.0 at `4314866a`:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-10-profile-export.test.js
```

Final-revision Speedscope application loading, browser qualification and measured
profiler-overhead thresholds remain separate gates.

`tests/a05-duration-profile-export.test.js` covers captured-duration schema cases,
rounding, zero/extreme boundaries, malformed/missing timing data, ownership and
source/reload/direct-CIL fixtures with an injected clock. It shares the existing
pinned-schema assertions with the instruction tests.

The instruction, duration and runtime-trace exporter cases passed in the serial
A05/preemption/security run at `3b482d83b`, recorded in `a05-main349-full-r1.log`. That broader
run had **3,162 passes, 25 failures and zero skips across 3,187 tests**; it was not
a passing full-integration result. Exporter assertions establish the tested JSON,
ownership and captured-weight contracts. They do not establish measured profiler
overhead, actual Speedscope application loading or browser qualification. The
28-test result above remains attached to its original revision and scope.

The later [published36 browser archive][profile-browser36] supplies the previously
missing actual application observation. At `36a2af53`, Chromium 153.0.8010.12,
Firefox 155.0 and WebKit 26.6 each loaded source, reloaded-source and CIL profiles
into the pinned official Speedscope 1.24.0 UI. The retained DOM rows and profile
files establish displayed method names and exact recorded instruction totals.
All eight browser cases passed per engine; those observations do not imply binary
`.nettrace` compatibility or duration-profile UI qualification.

The [strict off comparison][profile-off36] at the same public revision measured
all six required workloads, but every below-1% acceptance decision remained
inconclusive. Enabled overhead reporting is a separate required set of six rows.
Later runtime changes and the hosted qualification plan have no implied measured
result; the earlier failures, raw observations and reference patch remain intact.

[profile-browser36]: https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/ci-36a2af53-20261004/README.md
[profile-off36]: https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/profiler-off-36a2af532/README.md
