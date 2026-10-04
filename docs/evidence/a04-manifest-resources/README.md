# Manifest-resource qualification for #2470

The bounded manifest-resource reader was qualified from authored base
`f41f3e898aadd1890e66cc700121e7c198e3aa2a`. A new public-API regression first
reproduced a diagnostic defect: a 65-byte File hash produced `SFCLR007` instead
of invalid-image `SFCLR005`. The fix validates the canonical zero-copy CIL blob
view against the declared digest algorithm before creating an owned copy.
Caller-supplied metadata budgets and cancellation retain their original errors.

## Source and execution identity

| Stage | Commit | UTC interval on 2026-10-04 | Result |
| --- | --- | --- | --- |
| Regression, original product | `4827034c59fe3de0add23d5bf298e679fe6cad9d` | 16:26:59.951–16:27:00.397 | Exit 1; expected 65-byte hash failure; 1/2 passed |
| First native capture | `f5c4251d5e84b261172ed78e956eca6da565a580` | 16:30:27.534–16:30:32.973 | Exit 0; 24 files, 18 cases, two native readers |
| Original focused expectations | `f5c4251d5e84b261172ed78e956eca6da565a580` | 16:30:48.522–16:30:50.085 | Exit 1; 19/20 passed; native exception expectation differed |
| Corrected focused expectations | `099430d0eb0b564ebc33a435528e7d08d58d9ac9` | 16:33:47.409–16:33:49.260 | Exit 0; 20/20 passed, no skips |
| Five-series benchmark | `099430d0eb0b564ebc33a435528e7d08d58d9ac9` | 16:33:57.557–16:34:00.681 | Exit 0; all payload/name guards passed |

The product fix is the separate commit
`ce0f2017832df9d70e68c2fd5e3e5ab56979f9e9`. Capture hardening at `f5c4251d5`
retains original subprocess output, inputs and the build workspace, refuses
existing native output/evidence, and enforces exact installed toolchain pins.
The later `099430d0e` correction changes only native assertions and documentation;
it does not change the product, fixture bytes or observer sources.

Every listed pre-integration command ran once. The only pre-integration repeat
was the reviewed four-file run after correcting the native expectation. There was one native
capture and one benchmark run. The single heavy-work slot was released after
the benchmark. No broad suite, execution backend integration, browser, or Rust
qualification is claimed.

## Commands and retained evidence

All commands ran from `/workspace/scratch/7e3d2a445c44/sf6-manifest-resources`.
The regression command selected only `tests/clr-resources-manifest-hash-length.test.js`.
Native capture used:

```sh
SHARPFORGE_ORACLE_DOTNET=/workspace/scratch/7e3d2a445c44/dotnet-10.0.201/dotnet \
  node scripts/limited.js node packages/clr/tools/capture-manifest-resources.mjs \
  tests/fixtures/clr-manifest-resources \
  /workspace/scratch/7e3d2a445c44/manifest-qualification-f41f3e8/native-first
```

Both focused runs used the following exact file set:

```sh
node scripts/limited.js node --test \
  tests/clr-resources-manifest-hash-length.test.js \
  tests/clr-resources-manifest-malformed.test.js \
  tests/clr-resources-manifest-reference.test.js \
  tests/clr-resources-manifest.test.js
node scripts/limited.js node packages/clr/tools/benchmark-manifest-resources.mjs
```

[qualification.tar.gz](qualification.tar.gz) preserves the original external
qualification directory: five execution records with complete stdout/stderr,
both recorder sources, every native subprocess's arguments/status/raw output,
the native status/pin manifest, copied C# and harness sources, generated input
images, and the full retained build workspace. File contents are unchanged;
archive ownership and filesystem timestamps are normalized. SHA-256:

`232c8117dd87fa57b66d3cbce41425f553e10495a8ba24b8c9817efad8bbf827`

Execution records preserve source commits/trees, selected source hashes,
package tree identities and source-manifest hashes, worktree-local package
aliases, relevant environment, exact arguments, timestamps and output hashes.
All in-run source identities and raw-output hashes were checked, and recorded
intervals are ordered without overlap. Six local package aliases resolve to
this worktree; no install or shared workspace alias was used. The obsolete
untracked assembly-identity helper was not read into the product or committed.

The [native fixture](../../../tests/fixtures/clr-manifest-resources/native-manifest-resources.json)
contains complete input bytes/hashes and all original native observations. Its
SHA-256 remained unchanged from capture through the final benchmark:

`792517f6f4865a9ef648839c1eabd2eba62ded5bf78e951e2c07c2cddcbdc9d5`

The capture enforced SDK `10.0.201`, CoreCLR/reference pack `10.0.5`, and
MetadataLoadContext DLL SHA-256
`42fb03583ec0a097307dd94a0bb76f00cf18dd3241a8c8c93b9f28114dc06dfb`.
Observed framework was `.NET 10.0.5`; MetadataLoadContext assembly version was
`10.0.0.5`. Compiler, runtime and reference DLL identities are recorded. Package
sources were disabled; the installed reference pack satisfied the SDK build.

## Native differences retained

CoreCLR's linked File stream/info outcomes are null, including forwarded linked
files. MetadataLoadContext supplies the ordinary linked-file/module payloads,
but resolves linked modules by resource name and reports module resources with
null filename/location flags `5`. SharpForge follows the parent File offset and
reports physical module filename/location flags `1`. Consequently:

- `module-offset-disagreement`: SharpForge returns `EQ==`; MetadataLoadContext returns `AH+A/w==`.
- `module-parent-only-name`: SharpForge returns `AH+A/w==`; MetadataLoadContext returns null.
- `malformed-embedded-length`: both native readers still enumerate `payload`.
  CoreCLR stream throws `System.BadImageFormatException` (`-2147024885`) while
  CoreCLR info returns null filename/assembly and flags `5`.
  MetadataLoadContext stream and info throw `System.OverflowException`
  (`-2146233066`). SharpForge eagerly rejects enumeration/read/info with `SFCLR005`.

The last distinction caused the preserved first focused failure and is now
asserted explicitly. The linked-module difference guards retain their original
inequality scope, and the test does not claim complete MetadataLoadContext info
parity. Original outcomes are retained without normalization.

## Absolute costs

[benchmark.json](benchmark.json) is the unchanged benchmark stdout. Node
`v24.19.0`, Linux x64, AMD EPYC 9V74 80-Core Processor; recorded system memory
10,451,464,192 bytes. Resource defaults imposed one test worker/run slot and a
2,048 MiB child Node old-space cap. The benchmark ran in the reserved heavy slot.

| Operation | Median µs | p95 µs | p99 µs |
| --- | ---: | ---: | ---: |
| Cold index on an already loaded assembly | 3.205655 | 6.556230 | 11.826980 |
| Warm embedded read with owned copy | 0.551092 | 0.949231 | 1.243030 |
| Cold linked-file acquisition, copy and MD5 verification | 7.091015 | 12.983080 | 13.707540 |
| Warm verified-file read with owned copy | 0.848933 | 1.381246 | 1.408888 |
| Warm two-hop AssemblyRef read with owned copy | 2.890481 | 3.807945 | 3.917143 |

Each series discards 10 warmup batches and retains 100 chronological samples.
Cold batches perform 100 operations; warm batches perform 5,000. The true median
averages sorted samples 50/51; p95 and p99 use ranks 95/99. All summaries were
recomputed from the retained samples and match exactly. Payloads are 4 bytes
embedded, 55 bytes in the MD5-linked file, and 4 bytes forwarded; checksum is
35,288,000. Name/payload assertions and owned copies are inside the timings.

These are absolute API costs, not a before/after speedup, import/startup cost,
or first-assembly-load measure. There was no prior equivalent implementation.
Allocation counts and build/output-size changes were not measured; no relative
latency or size regression conclusion is claimed.

## Integration with current main

Actual merge-tree inspection found two conflicts with main
`19755847de71941a96ff4888d3b16402c966c401`. Merge commit
`f95f71c4e5e17704b3097c2b9b8491269bfa68e4` preserves both documentation additions
and all existing diagnostic IDs, including the additive `SFCLR014`/`SFCLR015`
File exceptions. The package index exports merged automatically. Of nine
manifest-owned product paths, eight remain byte-identical and only the public
index gains main's exports. The complete before/after source record identifies
78 inherited CLR/CIL product path changes. The native fixture, benchmark JSON
and original qualification archive remain byte-identical.

The same four-file focused scope ran once at this integrated source on
2026-10-04 **17:14:48.895915–17:14:50.623771 UTC** through `scripts/limited.js`,
with **20 passed, 0 failed, 0 skipped**. This new correctness gate covers the
inherited assembly, PE and metadata dependencies; it preserves the earlier
19/20 failure and corrected 20/20 qualification as distinct historical records.
No new native capture or performance measurement was performed.

[Integration evidence](integration-f95/manifest.json) retains the exact TAP,
stderr, execution receipt and source/conflict record, with hashes and byte counts.
The TAP SHA-256 is
`ab81975af8a5884a780f5bdfd70421f6617f7fd1aad52d4849c788956284a7ad`.
The source/conflict record SHA-256 is
`d9c1ee7968e12f525867ea1a96821e6ee410050841f3ba22a6bab34daf55e19a`.
The original absolute cost results describe their measured `099430d0e` source;
this integration gate does not establish updated performance or browser parity.
