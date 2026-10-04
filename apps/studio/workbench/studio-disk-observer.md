# Current-target disk observation and reload

`createStudioDiskObserver({documents, state, nativeBuild, target, confirm})`
composes the existing `DocumentService`, current Studio save targets, the strict
source decoder, and the native host client. `state()` and `nativeBuild()` are
getters. `target(uri)` returns the current `DiskWorkspace`, including a source
destination selected by Save As. `confirm(message)` may be synchronous or
asynchronous. The helper does not discover handles, request new permissions,
or change save targets.

## Observation and lifetime

`read(uri, {signal})` captures the exact document record/version and current
target/handle or native client/hash. Browser reads use `readStudioSource` with
the target record's known encoding, including BOM-free UTF-16LE and UTF-16BE.
They read slices of at most 256 KiB, enforce the disk policy and an additional
24,000,003-byte ceiling, and reject more than **8,000,000 UTF-16 code units**.
The byte ceiling accommodates the largest UTF-8 encoding of an admitted source
plus its BOM; UTF-16 has a lower maximum. Sources that grow on disk therefore
cannot bypass the automatic watch limit. Invalid UTF-8/UTF-16, contradictory
BOMs, and binary NUL input remain explicit failures.

Successful observations contain `text`, `encoding`, `bom`, `byteLength`, an
opaque `observation` token, an opaque stable `target` identity, and
`isCurrent()`. Decoder models are disposed in a `finally` block; ownership never
transfers to the document service. Only the bounded observation string and
immutable source snapshot remain reachable through a live token. Replaced
records/targets return no stale observation. Cancellation is an `AbortError`.
`dispose()` invalidates tokens and cancels active reads/reloads.

Native reads use the existing MSBuild file endpoint and its returned source,
encoding, BOM, byte size, and SHA-256. `MSBuildClient.read(path, {signal})` and
`binary(path, {signal})` forward cancellation to their existing request API.
The native server still owns its configured input byte limit. This does not
introduce an SDK build or a new transport endpoint.

## Reload commit

`reload(uri, text, {expectedRecord, expectedVersion, observation,
confirmDirty, signal})` requires the exact token and captured record/version.
A dirty-buffer confirmation is followed by another ownership/version check.
Browser reload then joins `DiskWorkspace.acceptBaseline` on the save queue and
rechecks the actual file's size, encoding, BOM, and bounded content. A save
committed first or another external change makes the observation stale.
Native reload rereads the same client and requires the observed SHA-256.

The synchronous `DocumentService.reload` commit retains the shared model,
changes its source and clean baseline, and applies encoding/BOM/byte metadata.
Its metadata contribution accepts the matching browser disk baseline/version
or updates `nativeHash` and `nativeBaseline` before document/model notifications.
A failure before acceptance publishes nothing. A notification failure after
acceptance is explicitly `DOCUMENT_COMMITTED` with `committed:true`; the matching
document and disk baseline remain committed. The next Save therefore uses the
new baseline and preserves the observed encoding.

FileWatch retains record/version/target identity with each observation and
passes the token through Reload. Reload, Ignore, and Compare all reject old
actions after replacement or a target change. The same external revision is
reported once for its captured document version. A later editor edit replaces
the stale prompt with one that can be acted on. Encoding/BOM-only changes are
observable. Recovery and file-drop behavior keep their existing limits.

## Coverage and qualification

This is the coherent follow-up for **SF-A19-T41 / #1477**, with the shared disk
encoding/large-source boundary also supporting **SF-A20-T44 / #1513**. Source is
in `studio-disk-observer.js`, `file-watch.js`, `document-size.js`,
`studio-source-reader.js`, `packages/project-system/src/disk/baseline-observation.js`,
and the additive native client cancellation forwarding. Atomic document reload
is contributed by the document service workstream.

The focused regression files are `a19-disk-baseline-acceptance.test.js`,
`a19-studio-disk-observer.test.js`, `a19-file-watch-observation.test.js`, and
`a19-native-disk-observer.test.js`. They cover the current handle, Save As
redirection, all three encodings, no-BOM UTF-16, reload followed by Save,
same-URI replacement, later edits, confirmation races, cancellation/disposal,
byte/character limits, native hashes, and committed notification failures.

At runtime source **`6d70fa30`**, one completed serial qualification invocation
passed **79/79 tests, zero failures and zero skips**, in **2.803 seconds** on the
shared Linux / Node **v24.19.0** host. It included 36 new cases: six baseline-acceptance, seven
FileWatch, fifteen browser-handle observer, and eight native observer/client
cases. The other 43 cases were the affected existing FileWatch, shell
boundary, captured document/disk save, encoding round-trip, and cancellation
regressions. Source included atomic document reload `03797840`; the later
`9d36c177` dependency update changed its tests and documentation only.

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a19-disk-baseline-acceptance.test.js \
  tests/a19-studio-disk-observer.test.js \
  tests/a19-file-watch-observation.test.js \
  tests/a19-native-disk-observer.test.js \
  tests/a19-shell-settings.test.js tests/a19-shell-boundaries.test.js \
  tests/a20-save-encoding-roundtrip.test.js \
  tests/a20-disk-save-cancellation.test.js tests/a19-document-disk-save.test.js
```

The native fixtures performed actual temporary filesystem reads, SHA-256
comparisons and writes for UTF-8, UTF-16LE and UTF-16BE. Browser file handles were
explicit doubles around real Node File/Blob slicing, including BOM and no-BOM
round trips, zero-byte sources, exact 8,000,000-character acceptance, oversize
rejection, and cancellation during decoding. No compatibility assertion was
weakened, and this observer invocation required no failure retry.

The fixtures do not qualify browser permission dialogs, an actual browser
File System Access implementation, screen readers, cross-platform filesystem
behavior, or a quiet-machine latency benchmark. They did not invoke MSBuild or
require an installed SDK. Root's Studio callback wiring and host lifecycle tests
are a separate assembled scope. The earlier 163-case save qualification remains
recorded separately; the 79 cases here are not all additional distinct tests.
