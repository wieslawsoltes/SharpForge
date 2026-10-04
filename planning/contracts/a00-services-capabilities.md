# Registry and Studio registration contracts

The baseline is the repository commit recorded in the validation evidence. The locks contain all 1,744 released framework members and 1,781 builtins, including 37 intrinsics. The issue's historical count of 22 intrinsics does not describe the current source.

| API | Capability | Limit / target |
| --- | --- | --- |
| `createRegistry().registerAll()` | Validated, transactional framework contributions with fixed ID blocks | Synchronous ESM; cross-contribution forward references require one batch |
| `contributionManifest` / `idReservations` | Frozen legacy order and stable A00–A29 reserved blocks | New members cannot extend a released block; reserve a new area |
| `createBuiltinRegistry().register()` | Atomic append-only intrinsic contributions | Does not change released framework offset or install a VM implementation |
| `createServiceRegistry()` | Isolated service factories with reverse rollback/disposal | Synchronous factories; service/document state remains in its current owner |
| `createCommandRegistry()` | Command metadata, duplicate rejection, async execution | Browser actions use existing Studio handlers |
| `createMenuRegistry()` | Ordered static/dynamic menu contributions and removal | Browser DOM rendering stays with ContextMenu |
| `createToolRegistry()` | Independent mount state, element, render and disposal | Built-in workspace tools intentionally share their workspace model |
| `createAutomationApi()` | Transactional namespace members with descriptor preservation | Existing `window.sharpforge` key paths are locked |
| `createStorage()` | Registered persistent keys, v1 compatibility, versioned values and quota results | Browser storage can be unavailable; no persistence success is claimed on failure |
| `createWorkerProtocol()` | 28 compiler and 46 runtime message handlers | Structured unknown-method errors; ESM and static worker bundles |

Runnable example: `node examples/registries/contributions.mjs`.

The dispatcher inventory runs both real JavaScript VM platform dispatchers. It distinguishes handler reachability from full method correctness: managed argument exceptions can establish reachability, while invalid/inconclusive fixtures remain `missing`. This is not native .NET CLR or Windows WinUI qualification. Browser native OS threads and Windows-only services remain unsupported.

Qualification commands (run after the complete extraction):

```
node scripts/planning/snapshot-contract-ids.js
node scripts/planning/check-contract-implementations.js
node --test tests/a00-02-registry.test.js tests/a00-03-studio-registries.test.js
npm test
npm run build
npm run test:packages
python3 tests/browser_test.py
```

The implementation report is a regression baseline, not an assertion that the whole BCL or WinUI APIs are implemented. A handler lost by either engine fails its gate. Any currently missing rows remain explicit follow-up work owned by their runtime areas.
