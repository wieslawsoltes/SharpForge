# Reproduce a release from a clean clone

Status: implementation provided; no acceptance captures have been run. The
`REPRO-UNMEASURED` entry in `blockers.json` remains open until two independent
operators retain and compare actual results. Operator names are declared
identities, not cryptographic attestations.

Use the committed acceptance branch with the exact Node/npm versions in
`planning/qualification/repro/toolchain.json` (currently Node 24.21.0 and npm
11.19.0). Each operator starts from a clean checkout of the same exact commit.
The command creates a separate clone with `--no-local`, checks out that commit,
verifies the clean source tree, vendors the locked npm cache, and uses the
existing A29 reproducible release builder. It builds the Studio distribution,
standalone IDE HTML and browser release ZIP, verifies the source manifest, and
captures the example/syntax/diagnostic/bytecode golden hashes. This is release
packaging; it does not implement the A26 runtime-only user-application publisher.

Operator one, on their checkout (replace COMMIT with its exact 40-digit SHA):

```sh
node scripts/conformance/acceptance/reproduce.js \
  --repository https://github.com/wieslawsoltes/SharpForge.git \
  --commit COMMIT --operator operator-one \
  --output artifacts/results/acceptance/release-operator-one
```

Operator two independently runs the same command at COMMIT with
`--operator operator-two` and a new output directory. A local repository path
can replace the HTTPS URL for an unpublished commit. The clone has independent
objects; it neither reuses nor alters the original working tree. Keep each
whole output directory, including `outputs/`, when transferring captures.

Compare the two retained captures from the same harness commit:

```sh
node scripts/conformance/acceptance/reproduce.js \
  --first /path/to/release-operator-one/report.json \
  --second /path/to/release-operator-two/report.json \
  --output artifacts/results/acceptance/release-comparison
```

The comparison rehashes the retained output bytes, rejects incomplete or reused
captures, and requires identical source, epoch, toolchain, release files and
golden results. Exit 0 means the comparison passed; exit 1 includes the failure
in `comparison.json`. Distinct operators/run IDs do not prove independent
hardware; reports record the actual platform. Windows, Linux and macOS are
unmeasured until their captures exist.

Record any remaining mismatch in `planning/qualification/blockers.json` with
its exact scenario/target and an existing task ID. Mismatches fail even if a
ledger entry exists; a blocker is not a waiver. Remove `REPRO-UNMEASURED` only in
a reviewed evidence update referencing both successful capture hashes.

All output directories must be new. The runner retains failed build reports,
uses the existing subprocess time/output limits, and kills owned process trees
on cancellation. No command uploads or publishes a release.
