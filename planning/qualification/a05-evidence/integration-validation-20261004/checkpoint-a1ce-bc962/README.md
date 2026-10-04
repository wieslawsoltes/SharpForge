# Correctness checkpoint command evidence

This additive archive preserves four original raw files byte-for-byte. The two
commands completed with exit code 0; each journal records the same clean Git
identity before and after its run. `manifest.json` contains the original paths,
byte counts and SHA-256 digests. The journals retain the exact argument arrays,
working directory, timestamps, Node version and resource settings.

| Command | Tested commit | Tested tree | Result | Wall time |
|---|---|---|---|---|
| `npm run check` through `scripts/limited.js` | `a1ce82342b906845dfa5001c1a45b2af35d06390` | `3275f92ca8f8227191fe3913abb73f9b4cb7f1e9` | Exit 0 | 7.35111122699891 s |
| `node scripts/conformance/oracle/license-policy.js` through `scripts/limited.js` | `bc9623e72d415e1a9f60d05ba1c76c9eeb9cac07` | `20e36ff9693b314dcef99635892fe13426944984` | Exit 0 | 0.4286077419965295 s |

The static checkpoint reports 30 areas, 1,362 Node test files and 38 browser
scripts, with no unassigned or duplicate entries. Syntax checking covered 4,832
JavaScript modules with zero syntax errors. The dynamic-code gate reports 4,776
inspected files and 4,823 linked modules, zero errors, and `passed: true`. The
original npm environment warning remains in the raw log.

The later oracle-license checkpoint reports `status: passed`: 7 tools, 14
packages, 4 actions, 3 images and 18,677 tracked paths. This is the policy check's
inventory and result, not an assertion that those tools or targets were executed.

Both journals record Node v24.19.0 and explicit resource controls of one run slot,
one test process and a 512 MiB old-space cap; the captured outer `NODE_OPTIONS`
value is null. Exact child settings follow the recorded wrapper command.

The archive is based on `bc9623e72d415e1a9f60d05ba1c76c9eeb9cac07`. The static
result belongs to its earlier tested revision and is not relabeled as a run on
the later checkpoint or this evidence commit. No command was rerun to prepare
this archive, and no product or progress ledger was changed. These two passing
commands do not establish unit-test, native, browser, performance, size, strict
structure or whole-project qualification. Existing failed and incomplete
observations remain retained separately.
