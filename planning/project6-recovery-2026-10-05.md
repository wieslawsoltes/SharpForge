# Project 6 recovery checkpoint — 2026-10-05

Status: blocked by an offline execution workspace. Project 6 is not complete.

## Intended work and authority

Continue the existing SharpForge Project 6 PR and branch work, then implement
the remaining project items fully, using isolated Git worktrees and subagents.
Existing work and qualification rules remain in force; this checkpoint does not
replace the issue acceptance criteria, reviewed source plans or raw evidence.

- Project: https://github.com/users/wieslawsoltes/projects/6
- Repository: https://github.com/wieslawsoltes/SharpForge
- Checkpoint recorded: 2026-10-05 00:40:14 UTC.
- Last reviewed main: c7e19ec89272f8a3193fc5720e403941e5a0520b.
- Main tree: 10868ce5bc175c7c0a44c72c87c9ef85f2fc9df8.

## Infrastructure blocker

Execution calls report HTTP 409 Conflict, environment_offline:
“Environment is not connected.” A later pending read independently returned
the same environment_offline failure. Root read-only health calls produced no
execution result and were terminated. No qualification job was active when
the workspace disconnected. GitHub connector operations continue to work.

A metadata-only inspection of all available tools found no documented execution
workspace reconnect, resume, restart or health capability. No escalation,
credential probing, security change or unrelated surface reset was attempted.

Local source and evidence below are last successfully observed states.
They have not been reverified during this outage. A failed or terminated write
must be inspected after recovery; do not assume it was absent or completed.

## Completed public work immediately preceding this checkpoint

- PR #4582: PE headers and section intervals; merged 2026-10-04 at 21:10 UTC.
  Merge: 8063c7519b922027b4854c8888df9b0cfe043e6b.
  https://github.com/wieslawsoltes/SharpForge/pull/4582
- PR #4586: final CIL maxstack and explicit tiny headers; merged at 22:55 UTC.
  Merge: 438e6ef456ec2953e18d62ab06b8fdd7cfb1095d.
  https://github.com/wieslawsoltes/SharpForge/pull/4586

Those completed batches do not close their broader issues #2417 and #2391.
Earlier Project 6 batches are recorded in their respective merged PRs.

## PR #4589 — canonical generic type instantiation

https://github.com/wieslawsoltes/SharpForge/pull/4589

- Branch: codex/project6-a04-generic-instantiation.
- Current public head: 15812e23df426d19b603a5e74cf263d14fc33a1b.
- Current public tree: 9ab1bd3c430e8b77444cfc7c5177756f7bd6e62b.
- PR is draft, open and cleanly mergeable at the last remote read.
- Qualified product: a5150472de399a1abea85db4229ead415522cf7e.
- Public source ancestor: 9cb725291ef2ae28a68655a5f47901ec73bf068a.
- That ancestor exactly represents local 1b69161ea2ec7c2be3abb773e890e1547afe3e79.

Recorded local qualification includes 126/126 tests across 30 files; the
independent native closure capture covers 34 cases, 71 requests, 38 identity
observations and 14 images. Three benchmark phases completed once, with
220 warmups, 2,200 measured batches and 53,482,000 validated operations.
The documentation example and untimed deterministic input reconstruction passed.
These are separate from the ordinary PR core workflow, which skips unit and
platform qualification unless explicitly triggered.

The performance budget did not pass. The automated root reviewer explicitly
accepted the quantified correctness costs, including warm graph p95 +12.2274%,
post-hoc p99 +28.9294% and mean +5.5196%. All 14 adverse measured statistics
are enumerated in the PR and retained local review. This is not a human approval
or a threshold pass. Do not offset adverse statistics with improved medians.

### Preserved first core failure and reviewed correction

- First core run: 37246720920; job 111565960135; failed in npm run check.
- Tested merge: b715200051132537ea729e924f8259706e199624.
- Failure: missing exact dynamic-import allowance for the unchanged benchmark.
- Driver: packages/clr/tools/benchmark-generic-instantiation.mjs.
- Driver SHA256: 435545681efeacd533534203b8e0ae3c5d5493325dacaa32e40fac3f7b562da6.
- Driver size: 15,495 bytes; exactly three dynamic imports, lines 17–19.

The imports select an operator-trusted local CLR entry and two fixed test
helpers. Managed metadata does not choose JavaScript modules. The driver's own
source snapshot follows those imports; no pre-import enforcement claim is made.
Independent source review approved the exact path/hash/count allowance.
The correction changes no product, observer, benchmark-driver or measured bytes.

The first decoded job log and failure record are committed under:

    tests/fixtures/clr-generic-closure/qualification-core-9cb72529/

- Decoded log: 278,077 UTF-8 bytes.
- Log SHA256: 332633ef43cb50e0015bfdf2d100a6b3469d5b2c4cbbc79651f0d297d2f0a120.
- Original decoded text was verified byte-identical after remote publication.
- Existing checker and linker remain unchanged.

### Corrected core passed

- Run: 37247923086; core job: 111569414785.
- https://github.com/wieslawsoltes/SharpForge/actions/runs/37247923086
- Head: 15812e23df426d19b603a5e74cf263d14fc33a1b.
- Tested synthetic merge: b008fc44560fcdb48627f56bf35f3ad8af03292c.
- Reviewed main base: c7e19ec89272f8a3193fc5720e403941e5a0520b.
- Completed successfully 2026-10-05 at 00:33 UTC.
- Static checks, review gates, build, clean checkout and preview creation passed.
- Unit tests and the full platform matrices were skipped by workflow policy.
- Integrated policy readback has 82 rows: all 81 main rows and the new allowance.
- The integrated driver remains byte-identical to the qualified driver.

### Pending local retention and documentation

Worktree: sf6-generic-instantiation.

- Last confirmed local commit: 48c3b667a23f97a99b2aba92bac9e2f979716b73.
- Tree: 35c644adcabb2257be341eca44931479edce13f7.
- Recorded clean immediately after commit; not reverified during outage.
- This commit is not published. It retains 58 originals, 2,622,730 bytes,
  plus three retention/provenance/protection records.
- Retention manifest SHA256:
  c0eccabf666570337361ff420488790fe5c7601f51d710bc99e94a38d735f543.
- Re-read the source-protection digest from its retained manifest after recovery;
  the summarized digest was incomplete and is intentionally not repeated here.
- Input-provenance SHA256:
  543ee86c5f3e709247f68a5305920c0cb489cc2f2a4d1b8a2fb369170ef0dbc0.

A later patch succeeded in these three worktree-relative files, but its
verification and commit are still pending:

- packages/clr/INSTANTIATION.md
- tests/fixtures/clr-generic-closure/README.md
- tests/fixtures/clr-generic-closure/qualification-benchmark-b3e97c09/README.md

After recovery, inspect these exact paths and preserve both histories. Merge
the public 15812e23 correction into the local retention/documentation history.
Do not force-push or rebase away either the public failure evidence or local
retention commit. Qualify the final packaged head, then merge and check main.
#2460 and parent #64 remain open, including their remaining platform/scope work.

## Remaining active lanes — last verified state

All lane heads below are local checkpoints unless a corresponding public
mapping is separately recorded. A prepared source or authored test is not a
successful execution. Do not mark these project items complete from this table.

| Worktree | Last confirmed local HEAD | State |
| --- | --- | --- |
| sf6-generic-constraints | c5e4f6409dffe37d2f1051ede099c008fa23acce | New product and replay gates unrun |
| sf6-heap-compression | 5be38b2241f04f9d3d8dc4b761c7f8a87f655226 | Performance v4 correction unfinished |
| sf6-ssa-consumer | a5415151c69f8aae2e8d923458d399247560e8a4 | Additive recorder v2 reviewed, unrun |
| sf6-calls | 595c7e07f030aa594a651d07ce56193ee6868da7 | Qualification v4 reviewed, unrun |
| sf6-parse-budgets | ce3a662ba7b6012801ef59dbc77c050196d119dd | Lifecycle correction unfinished |
| sf6-ssa | a0d26aecdb5e15f3da00cebca873206061629907 | 68/68 gate; benchmarks pending |
| sf6-exception-regions | 4afe1dc99c379415c503ad65db8b9b435ac19733 | 139/139 gate; benchmarks pending |

Additional prepared batches include constructors (d67f9653; depends on calls),
satellites (#2472; 9db0d5fe), and logical frames (#2532; bf23b45). Those remain
unqualified. Array/object instruction work (#2404) has a reviewed scope; the
new implementation worktree has not been started. This list is a recovery
checkpoint for active lanes, not a claim to enumerate every remaining issue.

### Generic constraints (#2463)

- Product checkpoint: f254c673767af83037593980fe0891522f4b10af.
- Tree at current c5e4f640: 3dea8dd453f19df9ddb23aece86e3a69917a8eff.
- Default and strict unmanaged policies have source reviews, but new runs are pending.
- Small gate plan: generic-constraints-product-gate-plan-f254.json.
- Plan SHA256: 409ad6d33b5289771baf5e078afeffd4653f5d028ce450055b35633718a8597b.
- Plan has 18 files, 100 authored test declarations and 473 source/helper/package pins.
- Original recorder: record-generic-constraints-product-gate.py; not admitted.
- Original recorder SHA256:
  da17dcab671260fcdce021479dfc4654c0a3ba56aa7acf26c62f1a9c352ca03d.
- Proposed v2 file: record-generic-constraints-product-gate-v2.py.
  Its write failed with environment_offline; inspect existence/content before any retry.

Finish the v2 recorder's physical file-identity checks, signal-safe child
ownership, process-group reaping and primary-failure preservation. Keep the
original recorder and plan exact. Obtain an independent review before the
small pure-product gate. The larger native/replay qualification remains pending.
Virtual static interface implementation authority remains explicitly unsupported.

### Heap compression (#2418)

The earlier focused gate passed 207/207 and five native phases completed.
The first performance v3 attempt failed during untimed prepare-baseline because
the default PE reader rejected the captured filter/finally body. It produced
zero warmup rows, measured rows or comparisons. Preserve that first failure.

- First attempt execution directory: project6-heap-compression-execution.replay-v3.
- First attempt performance directory: project6-heap-compression-performance.replay-v3.
- Outer execution receipt SHA256:
  fcc166eca30de1889deb0a6a9705641e8c88eaa0f913a906f76c51c21f623b62.
- Fixed baseline: f009e2949f3311f0ca84a4a6bc694535140d130b.

The additive v4 proposal uses readPE(bytes, {inspection:true}) only for untimed
captured-method validation. Timed workloads and corpus must remain unchanged.
Forty old native-bound source/tool files, including the global allowlist, remain
protected. A separately pinned external worker has its own exact two-import
policy. Root has not yet reviewed the new v4 code, and no v4 plan is frozen.

New v4 source files were written before the outage, but are uncommitted:

- scripts/benchmarks/heap-compression-input-v4.mjs
  SHA256: 7d0fa6f84a601c09320a09a59638cdc19dbf0876a0c2d8fc1f106c83a38e88a4.
- scripts/benchmarks/heap-compression-performance-v4.mjs
  SHA256: c48221df26c9d886b1cb42e0b47b478565789c4d6d74067a9607a429ade26225.
- External heap-performance-v4-worker.mjs
  SHA256: b622d52ca2532e0b00196dc8e86f317d05e912f9bcc91fc4f8f70b687dda6707.
- External heap-performance-v4-worker-policy.json
  SHA256: 0f52018748d8b4c90a5c153473e0fc88db8ac7f833bb930acb44fc541ef92a96.

Exact .source copies exist under the worktree's benchmark v4 directory.
A README write failed in transport; inspect its actual state before writing.
The 100 MiB floor, 26 children, 20 warmups/100 measured rows and 4,448,640
planned timed calls are protocol requirements, not completed observations.

### SSA consumer

Source-only root review accepted the additive raw-path v2 recorder. It preserves
raw NUL-delimited Git pathnames rather than normalizing whitespace. The original
preparation is retained unchanged. No phase has run.

- Root review SHA256:
  f6a00acde38d31be64b8738c1ea9a6debc1e12ac681d92ae3168ed5ecd87970b.
- Plan: ssa-source-plan-a5415151-v2.json.
  SHA256: 3e82008e48fb51a195e8d1f671fbf073c079c00d922b387e6745eff298514d12.
- Recorder: ssa-source-run-qualification-a5415151-v2.py.
  SHA256: 8c036e4ad231505679e50f49e2aa7318727428e7b1a37fd78396ee6f13a09465.
- Support: ssa_source_recorder_support_a5415151_v2.py.
  SHA256: 0642e17b10e259c38cddc3c570fc63b82349c51cf7c29d712aa7b756ddd02f16.
- Preparation SHA256:
  0e0d672acec572d89c3592a6d8bf26043a3f983b49ccff8fea057699aba9f8ae.
- Fresh output: project6-ssa-source-qualification-a5415151-raw-path-v2.

Both initial admission and the post-copy admission require 402,653,184 free
bytes. The eight planned phases include unchecked/checked native capture,
retention, 108 authored tests and three benchmarks. Recheck the exact plan
and physical source/tool/alias identities before granting execution.

### Calls

Qualification v4 remains unrun. The fixed floor is 384 MiB in every phase.
Plan: project6-call-plan/qualification-v4.json.
The queue is tool gate, native capture, retention, 20-file focused gate, then
quiet benchmarks. Native expectations include 79 cases and actual CoreCLR null
behavior; they are planned criteria, not new completed results.

### Parser budgets (#2415)

- Product checkpoint: 4856eaeaadafacfafe6dce38610ad7874ebf8de8.
- Current committed tree: 11bd947d82a558864d0c059ed82c861d75e710f0.
- Independent preparation review SHA256:
  ac2bea16a1528eaeff8ec48e196800c751a6fb05a33ce9a725f60cda576f898c.

Under tests/fixtures/parse-budgets, writes returned successfully for the original
nine-file preparation archive, owned-json.mjs, qualification-lifecycle.mjs,
adapted capture.mjs/benchmark-worker.mjs/benchmark.mjs, and
qualification_recorder_lifecycle_v3.py. None of this correction is committed.
The original v2 plan, recorder and review were not modified.

The pending write of qualification_recorder_sources_v3.py returned a final
failure after 1,033.8 seconds when disposed. Its actual destination state is
unknown. Do not retry it blindly. Inspect the diff and that exact path first.

Finish source/evidence helpers, the v3 entrypoint/plan/preparation, exact worker
hash admission and meaningful lifecycle regression coverage, then obtain
independent review. No product imports, tests, native processes, builds,
benchmarks, aliases or materialization have run for this correction.

## Capacity and one-time retirement records

Low free space remains a qualification constraint. Do not lower frozen floors
or infer current free space from old receipts. /tmp and the workspace share the
same volume. Installed native toolchains and captured source/evidence are retained.

The one-time sf6-maxstack retirement completed successfully and must not repeat:

- Script: retire-maxstack-once-b0930c21.py.
- Script SHA256:
  f70dda3e63ea48cdfcb1f841dbe2ee785e9da20e6fdfb4adb75ddf461871a203.
- Receipt: project6-maxstack-root-retirement-b0930c21.json.
- Receipt SHA256:
  eba9fa8037bf7672059a0de8d88dd71a0373789e287c0752669b7a6d150235a4.
- Git/admin/branch/registry and evidence were preserved.

First retirement of the historical PE baseline is prepared but NOT executed:

- Target: sf6-pe-baseline-d64188af.
- HEAD: d64188af91f03d02041316bdde2ee64fd0634be0.
- Tree: d683a1cee6e29cddb2735734878f70c1ea382a05.
- Script: retire-pe-baseline-once-d64188af.py.
- Script SHA256:
  693f8026b9a1b6d18560ed5e612aef4229380975e8164c1a61abb674d4859b07.
- Diff: retire-pe-baseline-once-d64188af.patch.
- Preparation: retire-pe-baseline-preparation-d64188af.json.
- Proposed receipt: project6-pe-baseline-root-retirement-d64188af.json.

Root's attempted script/diff review did not return before the outage, so the
retirement is not yet admitted. Review it and the exact current guards first.
All owners recorded non-use. Previously observed allocation was 114,155,520
bytes; that estimate is not a current admission result.

Previously retired paths or files may have reappeared. Treat reappearance as
an observation, never a reason to repeat deletion or change security settings.
This applies to earlier resource/analysis/CLR/symbol/metadata trees and the SDK
installer, as well as the successfully retired maxstack tree.

## Recovery sequence

1. Reestablish supported execution access. Inspect pending write destinations
   and exact last-known branch/worktree states; preserve original evidence.
2. Finish generic retention/documentation publication and reconcile public
   15812e23 by merge. Check the final packaged PR head, merge, and check main.
3. Finish/review the small constraints recorder and heap v4 correction.
4. Restore sufficient measured capacity without repeating prior retirements.
5. Execute admitted lanes one at a time through scripts/limited.js, preserving
   first failures, actual source/tool/protocol pins and partial raw output.
6. Pause all workers and root source/Git/publication activity during benchmarks.
   Accept any cost above 5% explicitly and quantitatively through automated
   root review, or fix it; never relabel a regression as a threshold pass.
7. Continue the remaining issue backlog and platform qualification. A source
   checkpoint, authored test or one Linux run does not complete an epic.

One heavy job is allowed team-wide, including PR/ref changes that trigger CI.
No heavy job is active at this checkpoint. Full CI remains staged for completed
epics. Existing A03 owner work (#2351–2359) and PR #3907 unload/CONTEXTS intent
remain protected. Never invent native observations or discard failed attempts.

## Worker ownership at pause

- assembly_analysis: heap performance v4 source/protocol correction.
- clr_services: generic constraints product, replay and small-gate recorder.
- project6_reconcile: independent source/protocol reviews.
- remaining_audit: parser lifecycle correction; SSA raw-path helper completed.
- ssa_analysis: generic evidence/docs retention; SSA consumer context.
- workspace_capacity: exact capacity and one-time retirement preparation.

All workers are paused. Prior pending reads/writes have been disposed where
reported; no terminated write is assumed atomic without recovery inspection.
