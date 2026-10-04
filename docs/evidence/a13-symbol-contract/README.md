# A13-01 symbols export contract qualification

The exact export list in `tests/a13-01-module-contract.test.js` omitted four APIs already
published by `packages/symbols/src/index.js` on main commit
`349c3d0d0375f2f15ffed4e102a7bfb8683c46e8`:

- `readPortablePdbDelta`
- `emitPortablePdbDelta`
- `PortablePdbGenerations`
- `PortablePdbRevisionMap`

Test-fix commit `037fa6385efa3489b7ca1b044e7d8a60240578a7` adds those four strings to the
expected list. The sorted `assert.deepEqual` comparison remains exact. The builder-isolation
and source-helper assertions are unchanged. No product files changed.

## Focused execution

The following command ran exactly once on each recorded source commit, in an isolated sparse
worktree at `/workspace/scratch/7e3d2a445c44/sf6-symbol-contract`:

```sh
node scripts/limited.js node --test tests/a13-01-module-contract.test.js
```

| Run | Source commit | UTC interval on 2026-10-04 | Result |
| --- | --- | --- | --- |
| Before | `349c3d0d0375f2f15ffed4e102a7bfb8683c46e8` | 15:54:39.087–15:54:39.651 | Exit 1; 2 passed, 1 failed, 0 skipped |
| After | `037fa6385efa3489b7ca1b044e7d8a60240578a7` | 15:54:59.702–15:55:00.423 | Exit 0; 3 passed, 0 failed, 0 skipped |

The before failure reports exactly the four unexpected actual exports listed above. Both
other tests pass before and after. The after run tests the committed fix with a clean tracked
worktree. The validation slot was released immediately after the after run completed.

Both runs used Node `v24.19.0` on Linux x64 with 10,451,464,192 bytes of reported system memory.
`CI`, `NODE_OPTIONS`, and the three SharpForge limit overrides were unset. The unchanged
resource wrapper therefore selected one test worker, one machine-wide run slot, and a
2,048 MiB child V8 old-space limit. These effective limits follow from the recorded wrapper
source and environment; the JSON records preserve the submitted command arguments.

The sparse checkout contained the test, wrapper and resource helper, root manifests, and
source/manifests for `symbols`, `cil`, `archive`, `bytecode`, `framework`, `bcl-core`, and
`bcl-collections`. Seven local package aliases resolved within this worktree. No fixture
files, installation, download, build, broader test run, or benchmark was needed. These are
qualification observations for this single test file, not a performance comparison or a
claim about the broader suite.

## Evidence and integrity

- [before.log](before.log): original combined stdout and stderr from the failing run.
- [before-execution.json](before-execution.json): its command, source, environment, status, and hashes.
- [after.log](after.log): original combined stdout and stderr from the passing run.
- [after-execution.json](after-execution.json): its command, source, environment, status, and hashes.

A local Python recorder launched the command with `subprocess.run`, captured the original
combined output, recorded UTC start/end times and the process exit code, and refused to
overwrite either run. The records include clean Git status before and after each run,
unchanged source commit and selected source hashes during each run, package tree identities,
and the resolved package aliases. The checked-out package source manifest covers 423 files.
Its SHA-256 is identical before and after:

`3b301593a9619c8f199043e80391d6e068f7e7fad0e7742945ee2a2e7f2cd8f6`

The manifest concatenates `repo-relative-path`, a NUL byte, the file SHA-256, and a newline for
each source file. Packages are ordered as in the checkout list above; files within each
package's `src` directory are sorted by path. The execution records also preserve the full
Git tree ID for each package. All package tree IDs are identical across the two runs.

| Artifact | SHA-256 |
| --- | --- |
| Before test source | `a433341df835cfbfc39ca2e51706080ade92927e0980a5a1f87857ef8095ca80` |
| After test source | `394898092e9f2a3befd7a5c351c9b4bda6e611f11008ab69960dad0f1bdef625` |
| Before log | `c3e7b0ada6fd649f0ff5e431438974a835d299f5edba3a61cd85b79921e9d4a3` |
| After log | `f588aee38f9f9d037c1f8e40a339a0f62efa01a5742f568dd33ea7292750f052` |

The original logs were copied byte-for-byte into this evidence directory. Their recorded
hashes, ordered execution times, unchanged in-run source hashes, and the unchanged package
source manifest were checked without rerunning the product or tests.
