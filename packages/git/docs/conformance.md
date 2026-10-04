# Git CLI, integrity and qualification

This package includes a reusable Node CLI, a read-only repository integrity verifier,
native Git differential fixtures, deterministic parser mutation fuzzing and a standalone
large-repository benchmark. These are separate entry points so a completed scope can be
qualified once without running heavy workloads after every commit.

## Node CLI

Run `node apps/cli/git.js -C DIRECTORY COMMAND`. The CLI composes `@sharpforge/git` and
`@sharpforge/git/node`; it uses the same repository, worktree, index, object and ref
implementations as other callers. `runGitCLI(argv, context)` and its alias `main` return
an integer exit code and accept explicit `cwd`, `env`, `stdout`, `stderr`, `signal`,
`fetch` or transport dependencies. The optional repository dependency is useful to
embed the CLI in a headless host.

| Command | Supported behavior |
| --- | --- |
| `init [DIRECTORY]` | SHA-1 or SHA-256, initial branch, bare metadata |
| `clone URL [DIRECTORY]` | Smart HTTP, branch, depth, filter, checkout or no checkout |
| `status` | Porcelain v2, NUL-delimited records, ignored paths, JSON |
| `add [PATH...]` | All changes, tracked updates, intent to add, explicit force |
| `commit -m MESSAGE` | Multiple paragraphs, configured/environment identities, explicit dates, amend, empty commits |
| `log [REVISION] [-- PATH]` | Limit, skip, author/message/date filters, first-parent, reverse and rename following |
| `diff [FROM] [TO] [-- PATH...]` | Worktree/staged/tree comparisons, patch, names, statuses, rename toggle |
| `push [REMOTE] [SOURCE:DESTINATION]` | Native receive-pack and fast-forward updates; verified policy inputs for rewrites |
| `rev-parse EXPRESSION...` | Scalar object IDs or explicit include/exclude revision sets |
| `blame [REVISION] -- PATH` | Line origin, original/final line numbers, structured identities |
| `fsck [OID...]` | Full local integrity report, optional explicit reachability roots |

Use `--json` for machine-readable results. Unknown flags, misplaced command flags,
unsupported porcelain versions and unsupported syntax produce explicit Git error codes.
Pathspecs after `--` may begin with a dash. Native errors and remote failures use stderr;
Auth/Network diagnostics do not print raw remote messages, response bodies or credentials.

Network permissions are explicit. A typical clone is:

```sh
node apps/cli/git.js clone https://example.test/team/repository.git \
  --allow-origin https://example.test
```

An Authorization value can be supplied through a named environment variable using
`--authorization-env NAME`, together with `--allow-credential-origin ORIGIN`. The CLI
does not put that value in arguments, config, result JSON or logs. A proxy requires
`--proxy URL` and grants for both the upstream and proxy origin. Credential-bearing
proxy requests also need both credential-origin grants. HTTP is limited to explicitly
enabled loopback fixtures with `--allow-insecure-localhost`.

The CLI does not synthesize approvals. Rewrite pushes accept a host-provided
`confirmation` and `verifyConfirmation`; the package policy enforces their binding to
the ref and expected/new object IDs. CLI ref deletion is explicitly unsupported. Local
filesystem clone URLs, SSH transport URLs, an interactive editor and the complete
native Git command/option surface are outside this CLI contract.

## Read-only integrity verification

```js
import { verifyRepositoryIntegrity } from '@sharpforge/git';
const report = await verifyRepositoryIntegrity(repository, {
  full: true,
  reflogs: true,
  index: true,
  verifyPacks: true,
  signal
});
if (!report.ok) console.error(report.diagnostics);
```

`fsck` is an alias. A repository supplies `odb`, `refs`, an object `algorithm` and,
when available, `store` and `config`. Verification never changes refs, objects, the
index, worktree or editor buffers. A promisor ODB's `readLocal` seam avoids implicit
network hydration. Missing promised objects are reported as locally missing; a caller
can explicitly fetch them and run verification again.

Checks include canonical loose framing, object address hashes, strict typed object
codecs, tree modes/order/names, commit/tag references, ref targets, indexed blobs,
packed-file/index checksums, graph connectivity and iterative cycle detection. Gitlink
targets are external repository commits and are not required in the local ODB. Shallow
boundaries suppress traversal of intentionally omitted parents. References, reflogs,
the index and explicit OIDs independently contribute reachability roots. Unreachable
objects are warnings and do not invalidate a healthy repository.

Diagnostics include a stable `id`, `category`, `severity`, message and applicable
object/ref/source/path. Categories distinguish `missing-object`, `broken-link`,
`hash-mismatch`, `bad-tree`, `bad-commit`, `bad-tag`, `bad-ref`, `bad-index`, `bad-pack`,
`type-mismatch`, `cycle`, `dangling`, `unreachable` and `invalid-object`. Results include
object, byte, edge, external-link, root, pack and reachability counts. Cancellation,
quota and explicit resource limits remain operation failures and are not downgraded
to ordinary corruption diagnostics.

Default limits are one million objects/refs, four million edges/roots, eight GiB of
expanded data across the repository, 64 MiB per loose envelope, ten thousand packs,
one million graph depth and one thousand diagnostics. These are explicit options for
trusted qualification fixtures. Traversal is iterative and retains object metadata and
typed edges rather than all decoded blob bodies. Full verification is linear in the
decoded objects and edges, plus sorting performed by the storage/ref providers.

Fetch verifies its received closure before publishing refs. Call this fuller verifier
after fetch when the host also needs existing unreachable objects, reflogs, the index
and every installed pack audited.

## Native Git differential suite

```sh
node scripts/limited.js node tests/git-conformance/run.js --output git-conformance.json
node scripts/limited.js node --test tests/a25-conformance-native.test.js
node scripts/limited.js node --test tests/a25-conformance-shallow.test.js
```

The suite creates isolated repositories with deterministic identities and timestamps,
records `git --version`, and never uses a public remote. If native Git is absent, it
emits `SHARPFORGE_GIT_CONFORMANCE_SKIP` with a reason; the Node test marks that case
as skipped. A missing capability in an installed reference is a failure, not an
automatic skip.

The fixture matrix contains 74 revision expressions per object format, thirty file
histories per format plus whitespace blame, history ordering/filter/rename comparisons,
and both SHA-1 and SHA-256 repositories. A complete CLI HTTP scenario runs separately
for each object format, including native format inspection, commit, push and proxy
clone. The CLI differential scenario creates the same
changes with native Git and SharpForge and compares commit refs, native-readable index
records and worktree bytes. It exercises clone, status, add, commit, log, diff and push
against a live loopback `git http-backend`, including clone through the configured
proxy. Corrupt native repositories compare missing-object and duplicate-entry bad-tree
categories with `git fsck --strict --full`.

The shallow HTTP fixture begins with depth one and compares native Git after relative
deepening by ten, absolute depth sixteen, shortening to four, and unshallowing the full
twenty-commit history. Both formats compare exact boundary IDs, HEAD, native-readable
index records, reachable commit/object IDs, worktree bytes and strict native fsck.
Repository log results and ancestor expressions observe each new boundary without a
manual cache reset; canonical commit bytes preserve their original parent IDs. The
unshallowed result also matches a separate native full clone.
The meanings of absolute depth, relative deepen and unshallow follow the
[native fetch contract](https://git-scm.com/docs/git-fetch).

`SHARPFORGE_GIT_CONFORMANCE` carries JSON pass/fail counts for every command family.
The runner returns a nonzero exit status on any mismatch, and the focused test is
discovered by the repository's normal `npm test` job. It does not edit tracked fixture
files, request credentials or depend on external network connectivity.

This harness qualifies Node and the native Git version printed in its report. It does
not claim browser, OPFS, IndexedDB, Windows, macOS or hardware-backed credential
coverage. Those engines require their respective integration jobs. A written fixture
is not evidence of a passing run: attach the resulting report when claiming acceptance.

## Deterministic parser fuzzing

```sh
node scripts/limited.js node --test tests/a25-fuzz-parsers.test.js
```

The normal test budget is exactly 1,000,000 mutated inputs, 200,000 each for pack,
delta, index, objects and pkt-line parsing. Index coverage includes DIRC v2/v3/v4 and
IDX2. Corpus controls are checked before mutation. Seed `0x0a250c0d` drives bit flips,
truncation, extension, runs, integer boundary values and splice operations. Selected
mutations repair framing/checksums so deeper semantic parsers receive malformed data
that is not rejected solely by an outer checksum.

Every mutated input must either return a bounded value or throw `GitError`. Unexpected
exceptions retain family, seed, iteration and exact hexadecimal input for replay.
Inputs and individual decoded objects are capped at 4096 bytes, pack/index counts at
32 and delta depth at 16. The worker has a 128 MiB old-generation cap, a 4 MiB stack
and a 300-second deadline. Typed-array payloads have explicit parser caps in addition
to the managed-heap cap. The report includes accepted/rejected counts and observed
maximum input size; it cannot establish safety for every possible input or platform.

## Large-repository benchmark

```sh
# Full profile: 100,000 text files, 1 GiB binary, 20 commits, three samples.
node scripts/limited.js node packages/git/bench/large-repo.js --output current.json

# Explicit reduced profile for integration of the runner itself.
node scripts/limited.js node packages/git/scripts/benchmark.js --quick --output quick.json

# A matching measured baseline enables the CI regression gate.
node scripts/limited.js node packages/git/bench/large-repo.js --baseline baseline.json --output current.json
```

The standalone benchmark generates deterministic, high-entropy binary data in 32 MiB
files, respecting the default per-object bound. It measures actual loopback smart-HTTP
clone and checkout, then status, log and blame on the result. Cold reads begin in a new
repository session after initialization; warm reads immediately repeat in that session.
Every clone uses a fresh destination. OS filesystem caches and the native server's
source data are not flushed, and the JSON makes that distinction explicit.

Output includes raw samples, median/p95/p99 milliseconds, sampled RSS and heap peaks,
process RSS high-water mark, storage bytes/files, object counts and explicit ODB call
counts. Machine, architecture, CPU, Node and native Git versions accompany the profile.
Three samples provide coarse tail estimates; use `--samples` for a larger sample count
when evaluating noisy changes. Checkout currently materializes its plan and rollback
data, so the full binary fixture can require several GiB of working memory. The
benchmark reports that cost and does not claim streaming checkout.

An identical-profile baseline is required to compare runs. Any measured median, p95,
p99 or RSS peak more than 20 percent above its baseline is recorded as a regression
and exits nonzero. A baseline is never synthesized from assumed performance. Run the
same profile on comparable machines, retain both JSON artifacts and wire the baseline
command into the completed-epic performance job. A quick-profile result does not
qualify the 100,000-file/1-GiB acceptance criterion.

Generated directories are owned temporary children and are removed on completion;
`--keep` retains a fixture for investigation and reports its path. `--directory` selects
the parent, not a directory to erase. The full benchmark is not run implicitly on every
unit-test invocation.

The programmatic runner accepts an `AbortSignal`; the CLI forwards SIGINT/SIGTERM to
the same cancellation path. Generation checks between bounded text batches and binary
chunks, native commands reject before spawning when already cancelled, and every
repository measurement receives the signal. Cleanup still closes files, repository
sessions, the HTTP fixture and owned temporary directories after cancellation.

A caught failure or graceful cancellation produces `BenchmarkFailure`, retaining the
original error as `cause` and a serializable `report`. The CLI saves that report to
`--output` before exiting unsuccessfully. Only completed samples appear in
`measurements`; `complete: false`, `ok: false`, and `failure.phase` identify the partial
run. Unfinished fixture or storage totals remain `null`. Such a report cannot be used
as a baseline. Abrupt process termination cannot execute this cleanup/report path.

## 100 MiB streaming pack memory fixture

```sh
# Run by itself in the qualification owner's serial slot.
node scripts/limited.js node packages/git/bench/pack-memory.js --output pack-memory.json

# This small smoke profile never satisfies the 100 MiB acceptance criterion.
node scripts/limited.js node packages/git/bench/pack-memory.js --quick --output pack-memory-quick.json
```

The full fixture contains 128 independently generated blobs of 819,200 bytes each:
100 MiB of payload, with an actual pack larger than 100 MiB. An independent encoder
writes PACK v2 entries and zlib stored blocks from deterministic high-entropy chunks.
Native Node crypto supplies reference object addresses and the pack trailer. Source
chunks are at most 65,535 bytes, and the complete pack is never buffered in memory.
The format follows [Git's pack specification](https://git-scm.com/docs/gitformat-pack).
Other focused pack fixtures exercise compressed blocks and delta reconstruction;
this fixture isolates sustained pack streaming and persistence at the required size.

A dedicated child process runs the production `readPack` with a four-MiB input
window and a real native loose-object database. Every resolved object must match
its independently generated address, type and size, and the persisted object list
must match exactly. After that child exits, native `git index-pack --strict` and
`git fsck --strict --full` verify the captured pack and persisted loose objects.
The native reference runs outside the decoder's measurement window.

The report records baseline and sampled peaks for V8 `heapUsed`, `heapTotal`,
external allocations, ArrayBuffers and RSS, plus the process RSS high-water mark.
Sampling occurs on every source chunk and decoded object and through a one-ms
timer. Synchronous transient peaks between samples may be missed. A 128-MiB V8
old-generation limit bounds the worker; no forced collection is used to lower
the reported result. Exceeding the fixed 64-MiB sampled `heapUsed` criterion makes
the command fail. That bound is **not** a total-memory bound: external and
ArrayBuffer memory and process RSS are reported separately, and ArrayBuffer
memory is already included in Node's external allocation metric.

`qualifyingProfile` requires at least 100 MiB of both payload and actual pack bytes.
`qualifies100MiB` additionally requires the measured heap criterion and successful
native verification. A reduced profile returns those flags as false even when
its own smoke checks pass. The full default workload has a ten-minute deadline;
no invocation or qualifying memory result is implied by the presence of this code.

## Serial package qualification entry

```sh
# Print the exact commands without executing them.
node packages/git/scripts/qualify.js --list --output /tmp/git-qualification

# Complete Node scope, then the full 100 MiB pack fixture, then the full large benchmark.
node packages/git/scripts/qualify.js --scope all --output /tmp/git-qualification

# After Node scope is already captured, select only the outstanding expensive scopes.
node packages/git/scripts/qualify.js --scope pack-memory,benchmark --output /tmp/git-performance

# A separately measured baseline enables the explicit twenty-percent comparison.
node packages/git/scripts/qualify.js --scope benchmark --baseline baseline.json \
  --require-baseline --output /tmp/git-comparison
```

This coordinator runs directly: each child stage acquires its own `scripts/limited.js`
slot, so wrapping the coordinator in another slot can deadlock a one-slot machine.
Stages always run in registry order and stop on the first failed stage. Node scope
discovers the complete top-level `a25-*.test.js` set with test concurrency fixed at
one, including native conformance and deterministic fuzzing. Memory and benchmark
stages use their full profiles. Reports retain the source commit, exact command
arguments, stage exit codes, timing, and the generated performance JSON artifacts.

The entry is package-owned and does not modify or register itself in a shared CI
workflow. That registration remains with the existing workflow owner. Without a
supplied measured baseline the performance output is a candidate, and this runner
does not infer baseline review or qualify unexecuted browser/platform jobs. Only the
team's validation owner should schedule these scopes after the implementation gate.
