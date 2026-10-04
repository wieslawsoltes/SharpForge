# PE bounds integration qualification

This is source preparation, not an execution result. The integrated product is
`8f0f0feec8ed8955e6119a346051ec6fdd965760`; its main baseline is
`f009e2949f3311f0ca84a4a6bc694535140d130b`. The bounds implementation is unchanged.
The merged PE reader forwards `metadataOptions` to the metadata reader, whose
implementation also changed on main. Fresh native qualification and a new paired
cohort are therefore required before attributing performance to this integration.

## Historical replay and strict qualification

The original `verify.mjs` remains byte-exact and defaults to `strictSource=true`.
It still checks every captured source hash against the current checkout when
called directly or by the benchmark. The historical native capture pins 424
files at `17de856493ba42091413e2968ad526efb7a79758`. Main integration changed four:
the CIL public entry, metadata reader, metadata table stream, and PE reader.
The other 420 still match. New preparation changes none of those 424 files.

The committed native test now calls the additive `replay.mjs` wrapper. It keeps
all original raw command status, log hash/text, native JSON, image identity and
comparison assertions, validates the historical commit and owned source/hash
inventory, verifies pinned native tool identities, and requires nine captured
fixture authorities to match the checkout. It does not claim that historical
product source equals every future checkout. The test additionally asserts the
exact 58-case ID roster, regenerates each authored image, checks its native hash,
and compares current product behavior with every retained authored observation.

The supplied IL, ReadyToRun and mixed-mode image facts remain historical in that
committed test. Supplied external image bytes are not retained by this fixture.
The new native phase compares all three supplied images with current integrated
product behavior; both explicit verifiers then check that capture strictly.
No historical receipt, expected outcome or performance result is rewritten.
This follows the separate historical replay and explicit strict-source contracts
already used by the metadata-generations native fixtures.

`integration-source-compatibility.json` records the four inherited differences,
95 byte-exact historical evidence/tool files, and the new preparation hashes.
The original benchmark driver, shared module, worker and integrated allowlist
are retained under `qualification/integration-preparation-8f0f0fee`, with source
Git blob IDs and SHA-256 hashes. None belongs to the old 424-source map.

## Reusable benchmark parameters

The existing driver accepts its original four option pairs unchanged. Without
additional options, its baseline remains `75f0caad1c3ea096a656feb2989b867781edc82f`,
its product revision remains `6e3d26f3ec6abe54699fce1caefa57e9a5c569f5`, and its native
reference remains `tests/fixtures/pe-bounds/reference`. Those defaults still
require the historical qualified source; they are not silently relaxed to admit
this integration.

An explicit trio may follow the original arguments:

```text
--baseline-revision <40-hex-SHA> --candidate-revision <40-hex-SHA> --native-reference <directory>
```

The shared source-identity function uses the supplied exact baseline and
unchanged-product descendant contract. Jobs carry the explicit revisions to
workers. Parent and child still check clean source, owned public aliases, source
inventories, exact tool hashes and the reviewed dynamic-import authority before
and after measurement. The existing worker's sole allowlist hash is updated;
its import expression, authority count and reason are unchanged, as are all
other 79 authorities. Explicit parameters are recorded in the report; historical
default job/report shapes do not gain an optional configuration field.

Fixture creation, complete reader facts, all guards, timer boundaries, 12-child
serial order, 20 warmup plus 100 measured batches, 1,200 chronological rows,
median/p95/p99 calculation and signed heap-delta semantics are unchanged. No
timed product code or benchmark algorithm was duplicated. Latencies are
distributions of batch means in microseconds per operation; heap deltas are not
allocation counts. This new cohort cannot revise the first cohort's disposition.

## Prepared phases and stop boundary

`validation-plan-integration-f009.json` contains exact command arrays and fresh
destinations. `run-integration-f009.py` derives from the unexecuted v3 recorder;
its changes are the plan filename, an explicit exact-HEAD argument, a tree hash
in snapshots, and source coverage for all seven existing gate test files. Before
and after every phase it records the NUL-delimited tracked diff against HEAD,
including staged and unstaged changes, and the actual untracked file roster.
Admission requires an empty tracked diff. Before retention there may be no
untracked files; from the retention phase onward, only files under the two
prepared retained-native and retained-execution directories are allowed.
An unchanged HEAD and stable hashes alone do not admit edited tests or tools.
The original `322afb6c` preparation was never executed; this source-review
correction changes no historical qualification result. The
v3 primary-failure retention, best-effort final inspection, child forwarding and
reaping, and final-write interruption check are unchanged. Restore prior signal
handlers, then check all interruptions handled through the final receipt write;
later signals use the restored Python/OS behavior and the caller must inspect
the actual exit. No interrupted execution is claimed here.

Each invocation performs only its named phase. After root review and a separate
sole-heavy-slot grant, use the final reviewed preparation HEAD as the second
argument, from the PE worktree:

```sh
python tests/fixtures/pe-bounds/run-integration-f009.py native <reviewed-HEAD>
python tests/fixtures/pe-bounds/run-integration-f009.py verify-external <reviewed-HEAD>
python tests/fixtures/pe-bounds/run-integration-f009.py retain-native <reviewed-HEAD>
python tests/fixtures/pe-bounds/run-integration-f009.py verify-retained <reviewed-HEAD>
python tests/fixtures/pe-bounds/run-integration-f009.py focused <reviewed-HEAD>
```

Stop on failure. Pause and release the slot after the seven-file focused gate;
inspect and retain native/gate evidence before requesting a separate performance
slot. Retention exclusively copies 13 files into `reference-integration-f009`.
It never replaces the historical `reference` directory. Future evidence commits
must leave captured source bytes unchanged so strict verification remains valid.
The fresh native source map will naturally contain more than 424 files because
it includes the now-retained historical qualification material and new tooling.

Only after that separate grant may the performance phase run at the reviewed
clean evidence-only descendant:

```sh
python tests/fixtures/pe-bounds/run-integration-f009.py performance <reviewed-evidence-HEAD>
```

It uses the prepared owned-alias baseline `sf6-pe-bounds-baseline-f009e294`, the
new retained strict native capture, and the fresh external
`project6-pe-bounds-performance.integration-f009` destination. Native and outer
execution destinations likewise use the distinct `integration-f009` suffix.
No phase loops, automatic retry, threshold pass or performance exception is
introduced. Browser, other operating systems and input-assembly execution remain
outside this preparation. Root owns qualification scheduling and publication.
