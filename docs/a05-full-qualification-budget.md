# Full qualification job budget

The ordinary `core` job retains its 20-minute timeout. When the existing full
qualification condition is selected (the `qualification` input, workflow
dispatch, merge group, or `full-ci` PR label), its budget is 90 minutes.
`core-platforms` already runs only under that condition and also receives
90 minutes. Other workflow jobs keep their existing budgets.

This allowance covers the complete serial `npm test`, repository checks, build
and Python infrastructure checks. Area manifests and individual test deadlines
are unchanged. The test runner still executes one file and one area at a time.
No corpus, sample count, benchmark option, regression threshold or performance
acceptance requirement changes.

The existing 20-minute allowance is inconsistent with the recorded workload:

| Retained selection | Recorded duration |
| --- | ---: |
| Full native numeric replay at `139917fe5f` | 706.730 seconds |
| Broad A05/preemption/security selection at `02c941f53` | 369.204 seconds |
| Actual PR-merge A00 execution at `4802e7382` | 78.451 seconds |

Those separate selections total approximately 19.24 minutes before the other
areas, installation, checks, build and Python steps. They ran at different
revisions and environments: this arithmetic is a scheduling estimate, **not a
measured same-host full-suite duration**. The 90-minute limit supplies explicit
headroom for the complete serial qualification; subsequent reports must retain
its actual elapsed time and outcome.

The published `312cd9242` PR run tested merge `4802e7382`, whose A00 selection
failed nine assertions after 78.451 seconds. It did **not** time out. Increasing
the qualification allowance does not repair or reclassify those failures.

The component timings remain in the
[numeric replay archive](https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/numeric-independent-20261004/README.md),
[final A05 validation archive](https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/integration-validation-20261004/native-repairs/final/README.md)
and the actual core job log `a05-ci312-core-job111502749706.log` retained by the
integration owner. Ordinary PR checks are neither broadened nor slowed by this
qualification-only scheduling change.
