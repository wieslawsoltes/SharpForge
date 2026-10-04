# Test status CodeLens

Work item: SF-A20-T18 / #1487. `createTestCodeLensProvider` connects the existing
Test Explorer `TestProviders` registry to editor language services. It creates
no synthetic tests, test results or independent execution backend.

```js
import { createTestCodeLensProvider } from './workbench/test-code-lens.js';

const testLenses = createTestCodeLensProvider({
  tests: workbenchShell.tests,
  getDocument: uri => currentSourceRecord(uri),
  projectIdsForUri: uri => workbenchServices.documents.projectsFor(uri),
  execute: operation => workbenchShell.tasks.run(
    { label: 'Run selected test' },
    task => operation.run({ signal: task.signal })
  )
});
const unsubscribe = testLenses.subscribe(() => editor.insights.analysis.refresh());
```

`getDocument` and `projectIdsForUri` are synchronous current-state lookups. A
source record has `uri`, integer `version` and preferably `length` or `model`.
The adapter never reads a lazy `text` getter. The record lookup should include
known workspace sources during discovery, even when their editors are closed.
Project ownership is a bounded array or Set of stable project IDs. Display
labels do not identify projects.

The returned methods are bound closures and can be registered directly with
`EditorLanguageServices`. The Studio compositor combines test `codeLens` items
with compiler reference lenses; it routes `data.provider === 'tests'` resolution
and the exact `sharpforge.tests.run` command to this provider. Unrelated compiler
commands and reference lenses retain their own providers. Dispose the refresh
subscription and adapter with the owning Studio services.

## Discovery and source ownership

Test records use the existing registry fields plus `uri`, `start`, `end`,
`version` and `projectId`. Offsets are UTF-16 code units. Explicit source versions
and project IDs are recommended. If a discovery omits a version, the adapter
captures the current version when that discovery is delivered, or when it first
attaches to an already discovered registry. It does not silently update that
version on a later edit. A missing project ID can be inferred only when the URI
has exactly one owner; adding another owner invalidates that inference.

`codeLens({uri, version, projectId?}, {signal?})` returns
`{uri, version, items}`. Items have exact source spans and
`data: {provider: 'tests', testId, version, projectId}`, without a command or an
eager status query. Missing locations, missing source records, stale discovery
versions and unowned/ambiguous tests are omitted until valid discovery. This
allows unrelated reference lenses to remain available. A stale requested source
version, missing document or mismatched requested project is an explicit error.

Discovery builds an index once, bounded by TestProviders' 100,000-test limit.
Requests inspect only tests for the requested URI; resolved status is read from
the live registry. More than 5,000 valid lenses in one file is an explicit limit
error, matching the editor's bounded lens surface. No source parse, source
materialization or test execution occurs while rendering or resolving a lens.

## Lazy status and execution

`resolveCodeLens({uri, version, lens}, {signal?})` validates the exact span,
registry identity, current version and project owner. It returns that same
source lens with a `sharpforge.tests.run` command and one argument:
`{testId, uri, version, projectId}`. Its label reports the registry's observed
Not run, Queued, Running, Passed, Failed, Skipped or Cancelled state and only
includes a duration when the provider supplied a finite nonnegative duration.

`executeCommand({uri, version, command, arguments}, {signal?})` revalidates all
identities and runs exactly the selected registry ID. It also accepts the
editor's usual `params.signal`. Optional execution wrappers receive
`{testIds, uri, version, projectId, signal, run}` and must call and await
`run({signal?})` exactly once. Deferred starts revalidate discovery and source
ownership. The wrapper cannot report success without invoking TestProviders.

The adapter forwards cancellation only to executions it owns. It does not call
the registry's cancel-all method or dispose the shared registry. Providers must
honor their AbortSignal; an already running provider is not described as stopped
until its registry run settles. Disposing the adapter cancels its executions,
removes subscriptions and refuses later requests. Up to 64 adapter executions
can be pending at once.

Actual discovered/test-state/run-ended/provider-removal events invalidate the
editor surface through `subscribe`. Run-ended matters because a failed,
cancelled or incomplete provider can change terminal states there. Unregistering
a provider removes its lenses and makes previously resolved commands unusable.
Errors use `TestCodeLensError` with codes SFTEST1001 through SFTEST1007.

## Evidence

The completed scope includes `tests/a20-test-code-lens.test.js`, which drives
real TestProviders, EditorLanguageServices and TaskCenter instances. It covers
lazy resolution, selected execution, status updates, source and project guards,
rediscovery, caller cancellation, provider removal, adapter disposal, wrapper
validation, error terminal states and bounds. Test execution itself uses explicit
registered test adapters; this does not qualify a CLR test runner or a browser
click path. Root owns final Studio provider composition and browser validation.

After the complete adapter scope was written, the following limited batch passed
29/29 cases (14 new CodeLens cases, eight retained Test Explorer/tool cases and
seven existing compiler/editor service contract cases), with zero failures or
skips in 1.507549 seconds:

```sh
node scripts/limited.js node --test tests/a20-test-code-lens.test.js tests/a19-shell-tools.test.js tests/a20-editor-language-worker.test.js
```

No browser, native test framework or Visual Studio oracle result is inferred
from these Node service/controller tests.
