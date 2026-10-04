# Return, array and A01 repair checkpoint — 2026-10-04

This checkpoint preserves two completed **failed** validation runs and the
source-level follow-up. The [manifest](manifest.json) records their distinct
revisions, trees, commands, counts and SHA-256 hashes. Counts overlap other
cohorts and must not be added.

| Completed run | Revision and result |
| --- | --- |
| [Local 20-file focused run](focused-return-array-a01.tap) | `111c299384fc98b7ed937789edd07ad79395ce75`, tree `04849c4af388f4a3ff8e88ced30afbaaf9535a5c`; 233 tests, 231 passed, **2 failed**, zero skipped; TAP duration 34723.039299 ms |
| [Actual CI core job 111517027079](a05-ci36-core-job111517027079.log) | PR merge checkout `edfa7cc8e11e05b9ceb0f6fdcb43fe071b24e11e`, tree `da3add4a11cce5ed887d2a093eac4b48a4c26754`; A00 **482/482 passed**; A01 **805 passed, 3 failed, 1 skipped** out of 809; overall exit 1 |

The local [original journal](focused-return-array-a01-journal.json) records
Node v24.19.0, the exact 20-file command through `scripts/limited.js`, all three
resource controls (1/1/512), timestamps, exit code, unchanged HEAD and empty
tracked status before and after. Its two failures are new profile classifications
in `syntax-legacy-adapter-profile.test.js`: the exact `o is int` and `o as string`
sources produce `SF2098` and `SF2200`, whereas the test initially expected
successful execution. The selected return, array, byref and filter tests passed.
That narrower result is not a complete A05 or repository pass.

The follow-up integrated as `13d250dec9bdbe3cb7ff25b0d78c28207aa45a5a`
preserves both original source strings. It classifies them as unsupported
bytecode-profile cases and asserts the exact diagnostic codes, expression ranges
and legacy messages. The initial checkpoint recorded a static review only; the
completed rerun below now verifies these assertions. It does not claim execution
support for these expressions.

The actual CI log identifies Node v22.23.3 and the GitHub-generated merge of PR
head `36a2af53287a563fd47d3a33b8e6e6382a726d35` into main
`f009e2949f3311f0ca84a4a6bc694535140d130b`. Independent committed-object inspection
confirms its tree equals the public reconciliation tree; the checkout SHA is
nevertheless distinct from the PR head. The three A01 failures concern the legacy
adapter's recorded-source comparison, repository-example comparison and runtime
profile diagnostic expectations. The complete original failure output remains
available, including its one skipped test.

The original files are retained byte-for-byte, including their whitespace. No
heavy work ran during either archival step, and no progress or acceptance status
was edited. The full A01 rerun was active at the initial checkpoint; its files
were appended only after root confirmed that they were complete and immutable.

## Completed full A01 rerun

At clean revision `6b3038a154be525c05a64ebae9912dd8b536bedf`, tree
`a59e2700a642c8c225619fa09d231ec5b27a1d12`, the
[full A01 log](full-a01-after-compatibility-repair.tap) records **844 tests:
842 passed, 1 failed, 1 skipped, zero cancelled**, with TAP duration
`168685.659606 ms`. The [original journal](full-a01-after-compatibility-repair-journal.json)
records Node v24.19.0, limits 1/1/512, the exact area command and unchanged clean
HEAD before and after. The repaired adapter comparisons and both exact `is`/`as`
negative profile cases pass in this run.

The sole failure is a file-level `SIGABRT` in `syntax-cancellation.test.js`, with
V8 reporting JavaScript heap exhaustion and GC usage around 507–508 MB. The
[read-only triage](cancellation-oom-triage.json) records identical Git blobs for
the cancellation test, document generator, token implementation, lexer, scanner,
parser and its budget, syntax tree, text entrypoint and syntax-edit helper between the earlier actual
CI checkout and this rerun. The only changed syntax/text path in that interval is
the legacy adapter's `statement-forms.js`.

The first cancellation test performs complete parsing and lexing of the 5 MB
input with non-cancelling callbacks before exercising cancellation assertions.
That calibration is a plausible source of the memory pressure, but the retained
native stack has no JavaScript allocation location or per-phase instrumentation;
the exact abort phase remains unattributed. The benchmark helper does not execute
its benchmark on import, and the syntax-tree implementation checks cancellation
before lexing. Absence of subtest output does not establish a module-setup failure.

The earlier CI passed all three cancellation cases using Node v22.23.3 and is not
a matched-memory comparison with this bounded Node v24.19.0 run. These records
establish neither an A05 regression nor a cancellation implementation regression.
They also do not establish a full A01 pass: the OOM failure and skipped test remain
part of the retained result.
