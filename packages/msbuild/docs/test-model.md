# Test discovery and run protocol

The public `@sharpforge/msbuild` entry exposes one data model for native and
portable test providers. This module describes records and progress; individual
adapters own discovery, framework support, execution and transport.

```js
import {
  createTestCase, createTestResult, TestOutcome, TestRunSession
} from '@sharpforge/msbuild';

const test = createTestCase({
  project: 'Tests/Tests.csproj',
  fqn: 'Example.Checks.Addition',
  displayName: 'Addition(1, 2)',
  rowKey: 'Addition(1, 2)',
  traits: { Category: ['unit'] },
  source: { path: 'Checks.cs', line: 12 }
});
const session = new TestRunSession({ id: 'run-1', tests: [test] });
session.start();
session.complete([createTestResult(test, {
  outcome: TestOutcome.Passed,
  durationMs: 4,
  backend: 'example-provider'
})]);
```

## Identity and discovery

`TEST_MODEL_VERSION` is `1`. `testCaseId(input)` derives the versioned identity
from the project path, fully qualified method name and row identity. Backslashes
in the project path normalize to slashes; case and other path components remain
unchanged. Row identity is `rowKey`, then `displayName`, then the qualified method
name. Supply a stable `rowKey` when labels may be enriched later. Provider names,
source spans, traits and native IDs do not enter the identity. The hash is a
stable display key, not a cryptographic proof or a filesystem identity.

`createTestCase(input)` validates those fields and returns a frozen record with
`schemaVersion`, `id`, `project`, `fqn`, `displayName`, `traits`, `source`,
`dataRows`, `skipReason` and `notRunnableReason`. Other provider fields survive.
Trait values are converted to strings and deduplicated. The record, trait
containers, copied source record and copied row array are frozen; nested
provider-owned row objects are not recursively copied or frozen.

| Field | Bound |
| --- | --- |
| Project and qualified method name | 4,096 characters each |
| Display name and row identity | 16,384 characters each |
| Trait groups / values per group | 256 / 256 |
| Trait name / value | 256 / 1,024 characters |
| Data rows | 10,000 |
| Source line | Positive integer, one-based |

Required strings cannot be empty and reject non-whitespace control characters.
Invalid records throw `Error`. Unsupported framework APIs belong in an explicit
`notRunnableReason`; skipping and inability to execute are separate facts.

`createTestTree(tests)` builds project/class/test rows in O(n log n), sorting
labels with JavaScript `localeCompare`. It accepts at most 100,000 records and
rejects duplicate test IDs. Use the normalized records from `createTestCase` as
input. Hosts needing a specific collation should set their display locale policy.

## Results and adapter contributions

`createTestResult(test, input)` requires one explicit `TestOutcome`: `passed`,
`failed`, `skipped`, `not-run`, `not-runnable`, `cancelled` or `timed-out`.
`durationMs` defaults to zero and must be finite and nonnegative. Results retain
text output, message, stack trace, source, attachments, diagnostics, backend and
optional native ID. Output text never determines a final outcome. Result and
attachment/diagnostic arrays are frozen; adapters own the nested payloads and
must enforce their transport and artifact byte limits.

`defineTestAdapter(adapter)` validates a nonempty ID and the `discover`, `run`,
`cancel` and `close` methods, then returns the contribution. It neither executes
those methods nor installs global state. The consuming host owns each adapter.

## Session progress and cancellation

`TestRunSession({id, tests, maxEvents, onEvent})` owns an `AbortController`, test
selection, results and progress. `start()` transitions from `created` to
`running`. `line({stream, text})` records output and recognizes VSTest progress or
a waiting testhost PID. These observations do not fabricate completed results
and the PID record does not attach a debugger.

`complete(results, backend)` records adapter-produced results. After cancellation,
it adds a `not-run` result for each selected test without an actual result,
preserving every result already received. The final session state is `completed`
or `cancelled`. `cancel(reason)` sets the signal for the adapter; the adapter must
stop its process or runtime and call `complete` with the available results.

The default replay budget is 10,000 events; the permitted range is 1–100,000.
`snapshot(after)` accepts a nonnegative safe-integer cursor and returns later
retained events, `nextCursor`, `truncated`, results and debugger handoff. Once a
budget is exceeded, oldest events are discarded and `truncated` reports a missed
prefix. Bounded replay and snapshots cost O(maxEvents); payload byte limits remain
the producing adapter's responsibility. No disk, process or network is involved.

Stop producers before `dispose()`. Disposal cancels active work, drops the event
observer and marks the session disposed; it does not destroy externally held
snapshots. Sessions are per run and are not shared between applications.

## Qualification and scope

`tests/a23-test-model-contract.test.js` exercises the public package entry,
identity/enrichment, bounds, immutable containers, tree duplicates, explicit
outcomes, adapter shape, event truncation, cancellation and disposal. Framework
discovery, TRX/coverage parsing, actual native hosts and portable managed execution
are separate dependent batches. This foundation alone does not close framework
or native test-execution acceptance criteria.
