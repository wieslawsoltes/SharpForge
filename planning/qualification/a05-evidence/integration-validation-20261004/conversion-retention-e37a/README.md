# Conversion failure-retention validation at e37a

The completed three-file selection passed **12/12 tests**, with zero failures,
skips or cancellations and exit status **0**. Test-runner duration was
**4,064.751406 ms**; command wall time was **4.225959823001176 seconds**.

The exact tested revision was `e37a5452944765f50c7bf32858e6a2ec2e1d1dc7`,
tree `e05560bf9690ee617676c1e62835d57c9b804b9e`. The original execution journal
records the same clean identity before and after execution. It records Node
**v24.19.0**, the limiter, one run slot, serial tests and a **512 MiB** V8 limit.
No .NET host or reference pack was selected in that command's environment.

- [Original TAP output](conversion-failure-artifacts.log) preserves every test,
  assertion result, duration and final summary without edits.
- [Original execution JSON](conversion-failure-artifacts-execution.json) retains
  exact ordered argv, environment, UTC timestamps, source identities and exit.
- [Archive manifest](manifest.json) records original paths, byte counts, SHA-256
  and Git blob hashes, plus tested source identities for the selected tests and
  relevant replay/finalization modules.

The log is **2,937 bytes**, SHA-256
`a933a73841286cf41fd3f1062fee156c9534248911c11a31fdf1816ff7398e5e`.
Both raw files are byte-identical copies of the completed scratch capture.

The new failure-retention tests passed: compiled CIL is copied and persisted
before any VM replay, a deliberately wrong authored answer preserves that DLL
and its hash, and the saved CIL executes the original operand independently.
A matching complete artifact inventory still cannot finalize the failed replay
as qualified. Mutating the observer's assembly copy leaves all three original
execution routes unchanged.

The adjacent ABI qualification and differential-helper checks also passed,
including route accounting, malformed provenance, output/quota failures,
overwrite refusal and hash-verified retained native64 fixtures. These are
qualification-machinery and bounded three-route unit checks. They are **not**
a new native oracle capture or the complete ABI32 conversion matrix. Actual
**2,277-case CLR10/X86 capture and source/reload/direct-CIL replay remain pending**.
No historical corpus, original failed run, acceptance wording or issue state was
changed. The selection is not a full A05, platform or performance qualification.

Only byte retention, hashes and source identities were checked while creating
this archive; no test, build, generator or benchmark was rerun.
