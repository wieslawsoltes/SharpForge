# Testing, native tools and runtime publication handoff

All **22 directly owned draft PRs and one delegated integration corpus draft** have a successful required `core` job on their recorded
current heads. All 23 local projection trees match the actual remote commit trees. Product source ownership is released and frozen for the
coordinator’s final complete integration qualification. The canonical composed source is `bb2b8d84c8dfc0b14fc76b2c605b84d48a1e993e` (tree
`9bf41c0b3ba02032b2e9688b2e51add271cdebcf`), with 227 selected files awaiting the coordinator run.

These records supplement the original per-leaf evidence in `../testing.json`; they preserve its measured results and remaining acceptance
gaps. They do not close issues or treat ordinary core checks as browser/native/platform qualification.

## Current publication stack

| PR | Feature | Current head | Required core |
| --- | --- | --- | --- |
| [#3676][pr3676] | test-model | `c7449d06738d` | [passed][core3676] |
| [#3680][pr3680] | managed-invocation | `d4f4df7a485a` | [passed][core3680] |
| [#3703][pr3703] | solution-configurations | `81e9ae2e0c6d` | [passed][core3703] |
| [#3717][pr3717] | test-formats | `0dfdc76c253d` | [passed][core3717] |
| [#3737][pr3737] | native-testing | `100fa0b9ff77` | [passed][core3737] |
| [#3767][pr3767] | managed-launch | `d8a62ba5cff1` | [passed][core3767] |
| [#3789][pr3789] | test-symbols | `edce4592e010` | [passed][core3789] |
| [#3816][pr3816] | native-workspace-state | `61f194b65d44` | [passed][core3816] |
| [#3828][pr3828] | test-runtime | `18a93a256fb7` | [passed][core3828] |
| [#3841][pr3841] | framework-discovery | `4db66c018c4c` | [passed][core3841] |
| [#3845][pr3845] | portable-testing | `87b56cb43c67` | [passed][core3845] |
| [#3872][pr3872] | runtime-types | `0cc072933097` | [passed][core3872] |
| [#3880][pr3880] | native-tool-renderer | `d49d58ed476d` | [passed][core3880] |
| [#3903][pr3903] | test-transports | `42ab679e87e5` | [passed][core3903] |
| [#3908][pr3908] | test-explorer | `224da54ab1f5` | [passed][core3908] |
| [#3915][pr3915] | project-runtime | `03432c9ab0d6` | [passed][core3915] |
| [#3922][pr3922] | project-debug-stack | `cbd0ed9f9787` | [passed][core3922] |
| [#3956][pr3956] | runtime-graph-worker | `05d4c991a132` | [passed][core3956] |
| [#3973][pr3973] | native-controller | `87af20b3951e` | [passed][core3973] |
| [#3991][pr3991] | native-registration | `c92984e79368` | [passed][core3991] |
| [#4129][pr4129] | evaluation-corpus | `cde580cba3b5` | [passed][core4129] |
| [#4193][pr4193] | msbuild-oracles | `75fd6dc0eb76` | [passed][core4193] |
| [#4181][pr4181] | project-reference-corpus | `d7cf835910f2` | [passed][core4181] |

`current-tests.json` and `current-runtime-ui.json` retain full heads, exact local/remote trees, ordered parents, bases and raw reported
mergeability. The two files partition the same 23 records; their overall counts must not be added. Metadata corrections and dependency
forwards update existing drafts rather than add publications.

Five main-based PR readbacks report `mergeable: false` (#3676, #3680, #3789, #3816, #3880). Their actual published commits include the
agreed pinned main `1db2e1d540a78403b7aaddcf472311fcde1a81ef`, and their required core checks pass. The raw flag is retained without
claiming compatibility with a later main or refreshing main again.

## Final dependency composition

- Runtime worker #3956 preserves upstream RuntimeActivity scheduling and teardown together with verified closed-assembly execution, launch options and source provenance.
- Native controller #3973 preserves the exact upstream native operation owner/job lifecycle, failure callbacks, cancellation and disposal while retaining contexts, profiles and Test Explorer.
- Registration #3991 merges those actual controller and renderer dependencies. Its four tool/layout/automation modules and all three original assertions remain byte-identical to the qualified source and the prepared final integration.
- The delegated closed graph corpus #4181 preserves all six original fixtures and the offline native helper. The only inherited test ownership correction removes a duplicate A05 selector already covered by its wildcard.

`forward-merges.json` records actual feature/base DAGs and exact source hash proofs. `core-readback.json` records successful core jobs,
actual step profiles and skipped qualification jobs. `retained-failures.json` keeps earlier failed attempts and their concrete corrections.
No test, build, benchmark, restore or manual CI dispatch was launched for these final projections or evidence assembly.

## Acceptance evidence and remaining gaps

`leaf-map.json` indexes all 23 originally assigned leaf/bug records. `leaf-projects.json` covers T09–T12; `leaf-frameworks.json` covers
T35–T39 and B05. The XML/edit foundation is published by the templates owner (#3553), the B05 reader by the evaluator owner (#3666), and the
unchanged graph corpus by the native owner (#4181). Those implementations are linked rather than copied into another feature.

The original owned scope passed 135/135 cases on each of Node22 and Node26; the native UI scope passed 106/106 on each. The closed graph
scope passed 415/415 on Node26 after the complete 68/68 affected Node22 correction. The later pinned-main integration initially reported 794
tests with 788 passes and 6 failures; its affected 77-case correction passed without skips. Those historical results are retained separately
from the coordinator’s final frozen-candidate run, whose outcome is pending in this handoff.

Native evidence retains five matching portable/native evaluation fixtures plus ten explicit native-only boundary fixtures, and 22 solution
mapping checks. The solution custom Build fixtures verify configuration globals and exclusion rules without claiming C++ toolchain
qualification. #4193 publishes the reusable solution/framework oracle harnesses; #4129 publishes the exact feature boundary and differential
reporting correction.

Shared xUnit/NUnit/MSTest fixtures executed on both source VM and direct CIL with expected passing, intentionally failing and skipped cases.
Actual native framework discovery names, TRX outcomes, coverage collection, testhost cancellation and debugger attachment remain
unqualified: the single shared 50-second package restore timed out, leaving an empty cache and no diagnostic cause beyond the timeout. There
was no additional retry.

Windows/macOS native hosts and Rust native/Wasm project/test invocation are not qualified. The protected Studio entry and matching root
package-lock change remain coordinator-owned integration steps; prepared sources are not represented as applied. Browser evidence stays
separate from Node results.

Three fresh benchmark medians exceed the contribution budget: dictionary source +10.66%, dictionary CIL +34.40%, queue CIL +8.43%. The
shared-machine measurements and raw samples remain available. Bounded CPU profiles did not reproduce the slower final run and established no
causal correction. No speculative optimization or noise explanation is claimed; explicit performance review/sign-off remains outstanding.
See `oracle-evidence.json` and the retained integration performance records.
[pr3676]: https://github.com/wieslawsoltes/SharpForge/pull/3676
[core3676]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37174198369/job/111353291984
[pr3680]: https://github.com/wieslawsoltes/SharpForge/pull/3680
[core3680]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37174287609/job/111353553378
[pr3703]: https://github.com/wieslawsoltes/SharpForge/pull/3703
[core3703]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37168809359/job/111337340538
[pr3717]: https://github.com/wieslawsoltes/SharpForge/pull/3717
[core3717]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37169006131/job/111337938534
[pr3737]: https://github.com/wieslawsoltes/SharpForge/pull/3737
[core3737]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37169446168/job/111339221144
[pr3767]: https://github.com/wieslawsoltes/SharpForge/pull/3767
[core3767]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37175129815/job/111356071729
[pr3789]: https://github.com/wieslawsoltes/SharpForge/pull/3789
[core3789]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37174647315/job/111354637707
[pr3816]: https://github.com/wieslawsoltes/SharpForge/pull/3816
[core3816]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37173976082/job/111352613877
[pr3828]: https://github.com/wieslawsoltes/SharpForge/pull/3828
[core3828]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37177309280/job/111362513325
[pr3841]: https://github.com/wieslawsoltes/SharpForge/pull/3841
[core3841]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37177310577/job/111362517281
[pr3845]: https://github.com/wieslawsoltes/SharpForge/pull/3845
[core3845]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37177312402/job/111362522595
[pr3872]: https://github.com/wieslawsoltes/SharpForge/pull/3872
[core3872]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37176884222/job/111361247820
[pr3880]: https://github.com/wieslawsoltes/SharpForge/pull/3880
[core3880]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37173981062/job/111352629362
[pr3903]: https://github.com/wieslawsoltes/SharpForge/pull/3903
[core3903]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37175318708/job/111356628229
[pr3908]: https://github.com/wieslawsoltes/SharpForge/pull/3908
[core3908]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37175360031/job/111356747106
[pr3915]: https://github.com/wieslawsoltes/SharpForge/pull/3915
[core3915]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37176476761/job/111360011917
[pr3922]: https://github.com/wieslawsoltes/SharpForge/pull/3922
[core3922]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37176886108/job/111361254038
[pr3956]: https://github.com/wieslawsoltes/SharpForge/pull/3956
[core3956]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37177478200/job/111363019499
[pr3973]: https://github.com/wieslawsoltes/SharpForge/pull/3973
[core3973]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37177754316/job/111363845120
[pr3991]: https://github.com/wieslawsoltes/SharpForge/pull/3991
[core3991]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37178301056/job/111365462027
[pr4129]: https://github.com/wieslawsoltes/SharpForge/pull/4129
[core4129]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37175610173/job/111357479762
[pr4193]: https://github.com/wieslawsoltes/SharpForge/pull/4193
[core4193]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37176551737/job/111360240823
[pr4181]: https://github.com/wieslawsoltes/SharpForge/pull/4181
[core4181]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37176518258/job/111360136578
