# Lazy Studio feature activation

## Lazy tool review scope

Review04 contains the docking, navigation, Watch and lazy tool source modules and their focused tests. Studio bootstrap wiring, actual Studio browser workflows, standalone bundling changes and A20 performance drivers remain in the dependent composition layer. Qualification records below describe the original completed source batches; no tests or builds were rerun for this review branch. The standalone docking DOM fixture is present and uses built assets with the production server/CSP, but remains unrun. See [project16-workbench-review.md](project16-workbench-review.md) for the exact scope and host contracts.

`createStudioLazyFeatures` registers the Designer, Assembly Explorer, Disassembly,
MSBuild integration, and Project Wizard through the explicit `studioToolLoaders`
module table. The normal editor startup imports none of those five controllers.
Each module and controller is shared by its first concurrent activations. A failed
module can be retried; disposing Studio aborts waiting activation and prevents a
late controller or DOM mount.

The small facades preserve the existing renderer, command, and automation
contracts. Panel rendering shows a loading status and an actionable error with
Retry. Opening a command or performing an operation returns an awaitable result.
Designer automation returns synchronous document results after its first awaited
activation. Controller configuration lives in bounded modules rather than the
Studio bootstrap. No controller methods are replaced and no Proxy is used.

The visible panel observer activates panels selected by a restored layout or by
the Window menu, including all Designer subpanels. Repeated layout notifications
leave a still-visible controller intact. Native status reads, configuration,
source invalidation, and cancellation preserve a cold startup. Only a URL carrying
the local-host capability activates automatic native connection; `MSBuildClient`
still validates and consumes that capability using its existing contract.

Document synchronization opens background source tabs without selecting them.
Dirty updates retain the selected secondary editor, Application window, or tool.
A changed active source URI still selects that document, and layout restoration
retains its persisted secondary view selection.

## Evidence and remaining qualification

`tests/a19-studio-lazy-features.test.js` covers cold initialization, all five real
factory paths through injected module constructors, concurrent activation, retries,
disposal, shared native state, restored panel activation, and automation return
contracts. `tests/a19-studio-docking-sync.test.js` uses the real docking model and
document tab policy to exercise selection and restoration. All 12 focused tests
passed through the serial resource-limited wrapper. Source syntax and new module
size limits also passed. These are controller and model checks, not browser paint
measurements.

`tests/browser_a19_lazy_tools_test.py` is the actual browser qualification fixture:
it observes module requests at cold startup and exercises every first activation
using built local assets with all external requests rejected. Chromium could not
be provisioned in this environment: the supported Playwright installer exhausted
its download attempts without a valid archive. The fixture has therefore not been
run here. Cold-start script evaluation reduction, browser first-use latency, and
fully offline standalone qualification remain unmeasured. Standalone packaging
now preserves deferred initialization of the closed module graph and embeds all
four actual worker graphs. Full normal/standalone builds and 26 combined focused
regressions passed; see `standalone-module-graph.md` for the generated-code and CSP
checks and their browser qualification boundary.
