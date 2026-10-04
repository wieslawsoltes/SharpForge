# Future PE qualification recorder

`run-step-v3.py` and `validation-plan-v3.json` are additive, unexecuted tooling.
The executed `run-step.py`, `validation-plan.json`, native reference, process
receipts and benchmark reports remain unchanged. Their original hashes and
source identities still describe the work that actually ran.

Independent review found a final-write cancellation window in the old Python
recorder: it decided `passed`, wrote the receipt with its interruption handlers
still installed, and then restored the handlers. A handled signal during that
write could be recorded after the success decision and still return success.
The v3 recorder restores the prior handlers and then checks for any recorded
interruption again. A newly observed interruption changes the receipt to failed,
retains its details and raises an error. An earlier primary error stays primary.
This reuses the source-reviewed EH recorder correction without changing the PE
capture, product, benchmark workers, workload order, samples or timers.

The successful-completion boundary is the final recorded-interruption check
after handler restoration. Every signal handled by this recorder before that
boundary must prevent success. Signals delivered afterward use the restored
Python/OS behavior; the recorder does not claim to consume or gracefully retain
post-completion signals. The caller must still inspect the actual process exit.
Disk failure, forced termination or host loss can leave partial evidence and
must never be inferred to be a pass.

All six actual PE phase receipts under
`/workspace/scratch/7e3d2a445c44/project6-pe-bounds-execution.cancellation-first`
contain an empty interruption list. The native observer, external and retained verification,
91-test focused gate and the single performance cohort retain their observed
results. This future-tool correction does not rewrite any of those outcomes or
claim that an interrupted execution was tested. The retained native capture was
made at `17de856493ba42091413e2968ad526efb7a79758`; performance measured the
evidence-only descendant `4890736f2da1bf2b8bd9c4e40f2f727b4d09f4d1` against
`75f0caad1c3ea096a656feb2989b867781edc82f`.

After separate authorization, the future invocation is:

```sh
python tests/fixtures/pe-bounds/run-step-v3.py native
```

The original phase order remains native, external verification, exclusive
retention, retained verification, focused tests and performance. Every future
output directory and the future retained-reference directory is distinct from
the executed evidence. The new reference is stored in `reference-final-write-v3`;
explicit verification reads it there. The unchanged seven-file focused gate and
benchmark still replay the original qualified `reference` corpus. The future
plan states this boundary rather than silently replacing that corpus.

No v3 phase, cancellation regression test, native capture, benchmark, browser
check or build has run. This document records a source correction and its
limits, not new qualification evidence.
