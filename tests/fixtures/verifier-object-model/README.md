# Nominal object verification corpus

`input.js` writes deterministic, independent CLI assemblies with real constructors,
types, fields, interfaces and custom attributes. `cases.js` fixes expected product
status/diagnostics and native acceptance before capture. Each assembly has multiple
methods; only the caller named `Test` is selected for ILVerify. Constructor bodies
remain outside the selected method's proof and outside this batch's this-state scope.

The corpus covers local class/value construction, arguments, visibility, invalid
constructor targets, abstract classes, exact nominal casts, boxing and unboxing,
readonly addresses, branches/joins and real emitted harmless, counterfeit and
ref-like attribute identities. Enum and external/delegate ancestry probes retain
explicit unknown reasons. Ref-like boxing declares the stricter product rule
relative to the pinned verifier's incomplete ref-like stack check; no difference
is relabelled as native parity. Ref-like construction and return are separate
cases so a lifetime rejection cannot be mistaken for a constructor rejection.

## Serial native capture and replay

Use the repository's pinned .NET SDK 10.0.201, runtime/reference pack 10.0.5 and
ILVerify 10.0.5, configured through `SHARPFORGE_ORACLE_DOTNET`, `SHARPFORGE_ILASM`
and `SHARPFORGE_ILVERIFY`. Native tools are qualification dependencies, not product
runtime dependencies. At the coordinating agent's serial validation slot:

```sh
node scripts/limited.js node tests/fixtures/verifier-object-model/capture.mjs /tmp/object-native.json
node scripts/limited.js node --test tests/a03-object-model.test.js tests/a03-object-annotations.test.js tests/a03-object-budgets.test.js tests/a03-object-model-native.test.js
```

The capture retains assembly hashes, fixture source hashes, exact tool and
reference identities, raw stdout/stderr, exit codes and parsed diagnostics. The
method filter is recorded as `\.Test$`; the shared capture parser must observe
exactly one selected method. A zero-match filter, multiple methods, process
failure or non-verifier diagnostic exit aborts capture. The replay test requires
the actual committed capture and fails if it is absent or stale; there is no
synthetic or skipped-pass fallback.

Node product tests bind fundamental and external identities from the existing
captured CoreLib metadata. Annotation facts are explicit host inputs keyed by
the exact emitted constructor tokens. Separate tests exercise missing, malformed,
throwing and asynchronous providers, repeated constructor caching, row/byte bounds,
cancellation, inaccessible/malformed operands and constructor/member limitations.

## Browser API and performance

The public API module `browser.mjs` exports `run()`. Invoke it using the repository's
browser qualification runner in Chromium, Firefox and WebKit. It uses clearly
synthetic canonical type authorities, replays the same emitted cases and adds
budget/cancellation/malformed-provider checks. That browser result is API
qualification, not a claim that these assemblies execute in a browser CLR.

```sh
node scripts/limited.js node packages/cil/tools/benchmark-object-verifier.mjs /tmp/object-verifier-performance.json
```

The object driver now reuses the repository performance protocol and existing
fixture helpers, with one first batch, 20 warmups, 100 measured batches and
1,000 calls per batch by default. It retains every chronological sample, checks
all results outside timing, and reports even-count median and nearest-rank p95/p99
of batch durations. Raw heap deltas are not allocation counts. Its new object
workloads measure added capability cost; existing controls run against the
qualified literal baseline, so literal changes are not attributed to this batch.

[QUALIFICATION.md](QUALIFICATION.md) gives the exact fresh-scratch native and
focused commands, prepared aliases, controlled baseline rationale, sampling bounds
and one-wrapper serial comparison command. Product source and native expectations
remain unchanged by this preparation. Neither tooling nor authored harness tests
have been executed for this preparation.

All capture, focused/browser execution and performance measurements are pending
the shared serial validation slot. The authored tests and harness are not evidence
of a pass. Broader source-VM/direct-CIL/native/Wasm execution admission remains
outside this typed API batch; #2403 and constructor/exception follow-ups stay open.
