# Bounded offline robustness qualification

This is the A29 T05 implementation for fixed, reviewed Node adapters. It composes
real SharpForge package APIs with deterministic variations of small owned inputs,
one disposable child per case, retained findings and ordinary-suite regression
replay. A passing run qualifies only its recorded input cases and adapter profile.
It is not a proof that arbitrary inputs or other engines are safe.

## Run and reproduce

Use a clean committed checkout and the existing workspace install:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/limited.js node --test --test-concurrency=1 tests/conformance/fuzz/*.test.js
node scripts/limited.js node scripts/conformance/fuzz/run.js \
  --target all --seed 1 --cases 32 --campaign-ms 30000 \
  --output artifacts/fuzz/owned-run-1
```

The output directory must be new. `--campaign-ms` is a deadline **per target**;
`all` executes eight targets serially. Each target receives the same unsigned
32-bit seed and independent case indices. The initial cases replay every owned
seed that fits the requested count; later cases apply bounded replacement,
truncation, deletion, insertion or duplication. Input bytes, seed name, operation,
case index and effective budgets remain in the report.

`summary.json` binds target reports by SHA-256 and records the clean source commit
and tree before and after execution. A changed or unavailable source cannot pass.
Each target retains accepted, controlled-rejection, unsupported, finding and
cancelled counts. Exit `0` means all requested cases in all selected profiles
completed successfully; `1` means a finding or harness/integrity failure; `2`
means unsupported, cancelled or incomplete work. Earlier failures are never
overwritten by a rerun.

The summary also retains reproduction commands as argv arrays, including the seed,
effective CLI limits and literal finding-directory paths. Run them from the
repository root at the recorded source commit and environment. They choose new
output subdirectories so the original observation remains intact; choose another
new output path when repeating a reproduction.

## Fixed execution contract

The public orchestration API lives in `scripts/conformance/fuzz/harness.js`:

```js
const report = await runCampaign({
  targetId: 'portable-pdb',
  seed: 7,
  budgets: { maxCases: 128, campaignTimeoutMs: 60000 },
  artifactRoot: '/absolute/path/to/a/new/findings-directory',
  sourceIdentity: { commit, tree, clean: true },
  signal,
});
```

`runCase` accepts one literal `Uint8Array`; `replayCorpus` reads checked records.
Target IDs come from `budgets.js`. The normal child statically imports
`targets/index.js`; no input or CLI argument supplies a module, command, callback
or executable path. Child environments omit ambient Node options and credentials.
The parent loads no parser packages while orchestrating a campaign.

| Resource | Default | Hard ceiling |
| --- | ---: | ---: |
| Cases per target | 32 | 4,096 |
| Input bytes | 65,536 | 65,536 |
| Target stdout + stderr | 65,536 | 65,536 |
| Case time after ready | 1,000 ms | 2,000 ms |
| Child startup time | 5,000 ms | 10,000 ms |
| Per-target campaign time | 30,000 ms | 600,000 ms |
| Net heap + external growth | 16 MiB | 32 MiB |
| V8 old space | 128 MiB | 128 MiB |
| Observed resident memory | 256 MiB | 256 MiB |
| Stored findings per directory | 128 | 128 |
| Stored record bytes per directory | 8 MiB | 8 MiB |

The fixed seed-control response has a separate 128 KiB cap for bounded base64
transport. Seed count is at most 32 and total seed data at most 64 KiB. Every child
is reaped before the next starts; cancellation and disposal overruns are recorded.

V8 limits do not cover all native allocation. Linux resident memory is sampled,
and returned peak resident memory is checked where reported. Reports distinguish
these mechanisms and explicitly set `osMemorySandbox: false`. The runner is not
an OS memory or network sandbox. Its adapters perform no outbound requests or
external program launches. Tooling self-checks use finite deadline/disposal probes,
a finite 4 MiB allocation and bounded output; they are isolated from product target
imports and cannot be selected by a normal campaign.

## Adapter coverage and outstanding requirements

| Target / work item | Actual exercised APIs | Remaining acceptance |
| --- | --- | --- |
| `pe-loader` / #1144 | PE reader, metadata validator, assembly inspector and loader with row/code budgets | Ten-minute and cross-platform captures; broader external corpus |
| `bytecode-image` / #1145 | Deserialization, verifier and [bounded managed source VM](bytecode-profile.md): static calls, storage, fixed objects and int arrays | Verified programs outside the closed profile return unsupported; no general-image, CIL or Rust execution claim |
| `portable-pdb` / #1146 | Portable PDB builder/reader, locations and locals with reader budgets | Broader existing/native corpus and platform qualification |
| `zip-archive` / #1147 | In-memory ZIP writer/reader and DEFLATE validation | Workspace import and filesystem extraction are not exercised |
| `protocol` / #1148 | LSP/DAP message framing, Unicode and deterministic chunking | Semantic server dispatch and request sequences |
| `il-document` / #1149 | Assemble, format, reassemble and compare the entire IL document, including `.image` | Cross-platform qualification; general ilasm and metadata editing remain outside this dialect |
| `msbuild-xml` / #1149 | Project XML and condition parser; fixed in-memory Exists results | Native MSBuild and external filesystem evaluation |
| `network` / #1150 | Outbound URL/header/grant policy and CSP generation | Native-host token, Origin and path checks are explicitly unsupported |

Unexpected exceptions remain findings. An adapter rejects only identified input
validation diagnostics. Errors while consuming its own generated canonical output
are findings, not malformed user input. Existing product defects are assigned to
their owning areas and require independently reviewed product corrections. The IL
result code `IL_DOCUMENT_EXACT_ROUNDTRIP` names full serialized-document equality.
Older retained `IL_DOCUMENT_VISIBLE_TEXT` results keep their original narrower
meaning and cannot qualify the new exact-image invariant.

## Finding retention and normal-suite replay

Findings retain literal input, input checksum, original finding, actual Node/OS,
source identity and normalized budgets in hash-named JSON. Reads validate record
and input digests, filenames, types, effective byte totals, target IDs and limits.
Symlinks and tooling-only records cannot enter production replay. Writes require
an exclusive `.corpus.lock`; an existing lock is an explicit persistence failure
and is never automatically stolen. Replay never changes corpus files or widens
their recorded budgets.

```sh
node scripts/limited.js node scripts/conformance/fuzz/run.js \
  --replay artifacts/fuzz/owned-run-1/pe-loader/findings \
  --output artifacts/fuzz/replay-1
```

Preserve the original report, fix the product defect in its owning area, then
promote the unchanged reviewed record into `tests/conformance/fuzz-corpus/`.
`retained-corpus.test.js` discovers every record through the normal A29 manifest.
An empty retained corpus is an explicit skip, never a passing parser campaign.
A continuing finding, unsupported replay or budget/integrity failure fails the
regression; there is no expected-success override for an unresolved finding.

## CI and evidence status

`.github/workflows/fuzz.yml` is manually dispatched and uses pinned actions,
read-only repository permission, serial local wrappers, explicit input validation,
checkout integrity and retained failure artifacts. This follows the current
[serial validation policy](../serial-validation.md). The older #1151 nightly
schedule requirement is not claimed: enabling unscheduled parallel specialty
work would conflict with that policy. The workflow has no release, Project-write
or provider credential permissions.

Focused tests qualify the tooling contracts and adapter fixtures separately from
actual mutation campaigns. A workflow definition or merged PR is not a hosted run.
Preserve exact runs, failed cases and unqualified target profiles when updating
the Project #4 delivery record.
