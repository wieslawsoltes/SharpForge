# Replay commands and invocation provenance

The execution coordinator recovered the seven-file gate and benchmark arguments,
but not a complete original shell transcript. The raw TAP does not include its
command or Node version. The benchmark JSON records `execArgv: ["--expose-gc"]`,
working checkout paths, commits, environment, fixture and driver/source hashes;
it does not record complete `process.argv`, environment overrides or shell
redirections. The commands below are **reconstructed replay instructions**, not
an exact historical shell transcript.

The recovered test-file names were reconciled against the files present at the
tested revision and the test titles in the retained TAP. In particular, native
files use `a13-05-native-*`, and revision files use `a13-05-revision-map` and
`a13-05-native-revision-map`; there are no extra `pdb-` components in those names.
All seven source file hashes are recorded in `provenance.json`.

Use a clean checkout at candidate
`9cfd593809f85c197be89990bcceaa22bfd0f898` with its normal package aliases, and a
separate clean baseline at `8b101c0c7e8ad73675dfe12e68f26329d7ea2d9c`. That candidate
contains the exact measured benchmark drivers. The writer-only publication base
does not contain the same revision/benchmark stack. The paths below are the
recorded local checkout and output paths; substitute paths for another machine.
Redirect outputs outside both checkouts so the benchmark's clean-tree checks
remain meaningful. No undocumented environment override is reconstructed here.

```sh
cd /workspace/scratch/7e3d2a445c44/sf6-symbols-revisions

node scripts/limited.js node --test --test-concurrency=1 \
  tests/a13-05-pdb-generations.test.js \
  tests/a13-05-native-generations.test.js \
  tests/a13-05-pdb-delta-writer.test.js \
  tests/a13-05-native-delta-writer.test.js \
  tests/a13-05-revision-map.test.js \
  tests/a13-05-native-revision-map.test.js \
  tests/portable-pdb.test.js \
  > /workspace/scratch/7e3d2a445c44/pdb-writer-revision-integrated.tap 2>&1

node scripts/limited.js node --expose-gc scripts/bench-pdb.js \
  --baseline /workspace/scratch/7e3d2a445c44/sf6-integrated \
  --baseline-revision 8b101c0c7e8ad73675dfe12e68f26329d7ea2d9c \
  > /workspace/scratch/7e3d2a445c44/pdb-existing-benchmark.json \
  2> /workspace/scratch/7e3d2a445c44/pdb-existing-benchmark.log

node scripts/limited.js node --expose-gc packages/symbols/benchmarks/pdb-generations.mjs \
  > /workspace/scratch/7e3d2a445c44/pdb-generation-costs.json \
  2> /workspace/scratch/7e3d2a445c44/pdb-generation-costs.log
```

The benchmark outputs contain 100 measured rounds after 20 warmup rounds for
every workload, plus one separately labeled first timed call. Exit code zero was
reported by the execution coordinator for both benchmark processes. The original
empty stderr streams are retained; they are not replacements for a full shell
transcript. The source-bound JSON facts are the primary benchmark provenance.
