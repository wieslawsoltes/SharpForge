# Reproducible release qualification

Task SF-A29-T09 (#405), leaves #1175–#1179. These checks establish byte
reproducibility and artifact integrity. They do not establish language/runtime
parity or claim platforms that have not independently run the workflow.

## Runnable local walkthrough

Use the exact Node and npm versions in [toolchain.json](toolchain.json). Commit
all intended source first: archive inputs come from the requested Git revision,
never from uncommitted source or installed workspace symlinks.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/build.js
node scripts/standalone.js
node scripts/verify-packages.js
node scripts/conformance/repro/package-release.js
node scripts/conformance/source-manifest.js --generate
node scripts/conformance/source-manifest.js --verify
node scripts/conformance/repro/double-build.js
node scripts/conformance/repro/examples.js
node scripts/conformance/repro/link-check.js --assets artifacts
```

`double-build.js --ref <commit>` verifies and extracts an actual Git source ZIP
twice, reverses extraction order, changes input mtimes by one day, installs with
`npm ci --offline` from a lock-bound cache, builds dist/HTML/all workspace tarballs,
executes the package-owned installed API smokes, and compares all payload bytes
plus the existing A00 golden compiler contract. Its reports identify the exact
source and harness commits, Node/npm versions, epoch, commands and elapsed times.
Two elapsed samples describe this validation run; they are not p95/p99 or an
allocation benchmark and do not claim a performance qualification.

## Contract and integration

| Capability | API / command | Failure contract | Evidence target |
| --- | --- | --- | --- |
| Release tree integrity | `source-manifest.js --generate`, `--verify` | Changed, missing or extra dist or payload file fails, including a single byte flip | Independent Node host |
| Payload-only verification | exported `verifyManifest(directory, manifest)` / `--verify-payloads` | Exact artifact set and hashes; deliberately does not qualify a dist tree | Artifact-only publisher / attestation |
| Deterministic packaging | `package-release.js` / `canonicalZip(entries, epoch)` | Rejects links, empty trees, nonportable names and epochs outside ZIP range | Independent Linux, macOS, Windows |
| Double build | `double-build.js` / `compareBuilds(a,b)` | Source, toolchain, output inventory or golden-output mismatch fails | Two isolated trees per host |
| Cross-runner match | `aggregate.js` | Missing/duplicate/failed platform or any output mismatch fails | Linux x64 + macOS arm64 + Windows x64 |
| Offline release rebuild | `offline.js --archive … --cache … --assets …` | Unverified source/cache, missing artifact, stale example or unexplained hash difference fails | Node host; Linux namespace separately qualified |
| Committed example freshness | `examples.js` | Lists exact stale paths and generator-order differences, including generated Studio mirrors | All six generators, forward and reverse |
| Documentation links | `link-check.js` | Relative targets must exist in Git or in a verified release payload set | Local links; external HEAD requests only on explicit dispatch |

The integrated release workflow calls
`node scripts/conformance/repro/package-release.js` after downloading the
qualified dist. It generates and strictly verifies the manifest in that build stage.
The artifact-only publisher uses `--verify-payloads`; omitting dist from the strict
`--verify` invocation is an error. Existing `files` records and the exported
payload verifier remain compatible with the supply-chain attestation service.

## Determinism audit

`scripts/build.js` copies registered source/assets and performs per-file import
rewrites. Its directory visit order does not enter file content. Worker bundles
use source import order and stable DFS module IDs. `standalone.js` combines those
fixed bytes without wall-clock timestamps. No product build-script change was
needed; the harness tests their actual outputs after reversed creation order.

All subprocesses inherit the exact commit's `SOURCE_DATE_EPOCH`, UTC and C locale.
The browser ZIP uses the existing portable STORED ZIP writer, sorted paths, fixed
0644 files, no extra fields and an explicit UTC DOS timestamp derived from the
epoch (ZIP's two-second precision). It has the effect of fixed mtimes plus `zip
-X`, without depending on a host zip implementation or compression version.
Archive paths, CRCs and bounds are revalidated after writing. npm is pinned;
`npm pack` supplies its canonical tar order/mtime and is checked byte-for-byte,
including with different source mtimes. Text checkout policy is LF.

## Exact release archive and offline cache

`prepare.js --tag vX.Y.Z` is read-only: it resolves the local fetched tag to a
commit, downloads GitHub's ZIP for that exact commit, verifies every file against
the authoritative Git tree/blob IDs, downloads the existing release manifest and
each named asset, and vendors a lock-bound npm cache. Traversal, duplicate paths,
symlinks, missing/extra files and altered source bytes are rejected before any
extracted script executes. External dependencies require an exact HTTPS tarball
and integrity in the lock; npm's offline installer verifies tarball integrity.
The current lock has no external dependencies, so its legitimate cache is empty.

The workflow transfers the archive and sealed cache as artifacts. On Linux it
runs the complete rebuild and example generation under `unshare --net`, verifies
the separate network namespace and failed egress, then compares release assets.
For a branch/manual run without a release tag the comparison assets are the
independent Linux build; the report must not be described as a published-release
rebuild. Ordinary PR/main pushes and schedules perform no native reproducibility jobs.
Manual and product release-published events retain serial qualification; historical
evidence-archive releases are excluded. External links run only with the explicit
`external_links` dispatch input instead of rebuilding. Nothing publishes a release.

`offline.js` also runs locally with npm offline mode; without
`--require-network-isolation` its report explicitly does not qualify kernel
network isolation. A missing Linux namespace is a failure, never a skipped pass.

## Differences, cleanup and evidence

[explained-differences.json](explained-differences.json) is committed source and
starts empty. A reviewed entry must bind one exact path and both SHA-256 values,
give a substantive reason and link an issue. Wildcards, missing artifacts,
duplicate rules and unbounded exceptions are rejected. The offline report prints
the complete policy and unexplained changes; unexplained differences fail.

Every temporary tree and private npm cache is disposed in `finally`. Cancellation,
timeouts and bounded-output failures terminate the child process tree before
cleanup. Tracked output is never restored to hide a mutation. Workflow reports
and failure diagnostics live under ignored `artifacts/results/repro/` and are
uploaded even on failure. Actual target qualification is recorded in the PR and
retained runner reports; unrun targets remain unknown.

The first real capture exposed existing stale generated examples. See
[the reviewed prerequisite refresh](generated-example-refresh.md) for exact
out-of-area paths, semantic changes and retained before/after evidence.
