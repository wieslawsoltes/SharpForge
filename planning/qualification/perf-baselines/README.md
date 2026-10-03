# Reviewed performance baselines

Capture at a clean commit. Raw sample arrays, exact commit, environment and correctness
checks are mandatory. Never reconstruct samples from historical medians. The A/B gate
executes both commits independently in disposable worktrees on one runner; historical
baselines describe a runner and are not substituted for current base runs.

To propose a baseline, run measure.js with at least 20 samples, save its environment
object as an environment JSON, then run update-baseline.js with --raw, --env, --id,
--review-url, --reviewer and --reason. The writer retains every raw measurement and
environment in baseline.json, with SHA-256 digests. The review fields identify the
requested review; they are not proof that GitHub has approved a PR. Commit the result
and have a reviewer approve the raw evidence and changed budgets before merge.
readBaseline reads Git object contents only; dirty or untracked baselines are ignored.
The measurement commit must exist in this repository.

Keep the complete artifacts/results/performance directory with CI artifacts, including
all stdout/stderr, pair order, cold/warm samples, environment and browser trace ZIPs.
CI retains raw data for 30 days. Long-lived accepted baselines retain canonical raw
samples here; browser trace archives remain attached to the review's CI run.

A quarantine needs an exact adapter ID, reason and future expiry in quarantine.json;
it is explicit and visible in the summary. It never converts a regression into a pass.
Removing, adding or changing budgets/quarantines requires review of the committed diff.
