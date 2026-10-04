# Main438 integration checkpoint evidence

This additive archive preserves ten original postmerge files: four logs, their
four execution journals, and the two exact local review-context files. The
`premerge-7f/` directory separately preserves an earlier review log, journal,
event and environment. All fourteen raw files are byte-identical to their
captures; `manifest.json` records their original paths, lengths and SHA-256
hashes. Journals retain exact argument arrays, timestamps and environment.

| Capture | Tested commit | Result | Wall time |
|---|---|---|---|
| Static checks | `6cf77967f00e4ddd0ce6987ad4aa2b99e5470c22` | Exit 0 | 7.2117446289994405 s |
| Header/filter merge regression cohort | `e16e011ac2b8b789646f861a2e6261a03ddcee2b` | 64 passed; 0 failed/skipped; exit 0 | 7.606227447999117 s |
| Oracle-license policy | `e16e011ac2b8b789646f861a2e6261a03ddcee2b` | Exit 0 | 0.405699161994562 s |
| Local postmerge review-gate reproduction | `e16e011ac2b8b789646f861a2e6261a03ddcee2b` | Exit 0; changes/errors empty | 0.6644608429996879 s |
| Separate local premerge review reproduction | `7f84164bfa3d63326f272e9b1e58265d98eb93b4` | Exit 0; changes/errors empty | 0.4319602859977749 s |

Each journal records identical clean start/end identities. The static tree is
`f25dba30dcfc8d0a003e00c8a060b5c9fe1e1aed`; the later integration tree is
`fe4afe1b9a97d3deb47390711fb1cc3b0ce29639`. The earlier premerge tree is
`67014991d84cd1ebaf9bb49738455faafaac619b`. Each result applies to its own
recorded revision, not to the evidence commit.

Static checking reports 1,368 Node files, 4,848 syntax modules with zero errors,
and 4,792 inspected / 4,839 linked modules with zero dynamic-code errors. The
original npm warning is preserved. The ten-file header/filter cohort reports
64 tests, all passing, zero skips, and 7,400.259436 ms test duration. Its journal
lists the exact selected files. The oracle-license check reports 7 tools,
14 packages, 4 actions, 3 images and 18,997 tracked paths; this inventory is not
a claim that all tools or platforms were executed.

Both review runs are **LOCAL constructed PR-event reproductions, not observed
GitHub jobs**. Their saved input describes PR4507 with its existing `full-ci`
label. The postmerge reproduction compares against
`438e6ef456ec2953e18d62ab06b8fdd7cfb1095d`; the separately retained premerge run
compares against `aa74558ccae4851817b23d0a19c5fdfb1ef5a350`. Exact event paths,
head values and environment are retained without rewriting their original
absolute paths. The successful outputs have empty `changes` and `errors`.

All journals record Node v24.19.0, one run slot, one test process and a 512 MiB
old-space resource cap. No command was rerun for archival. No product or
progress ledger was changed, and unrelated sparse archives were not
materialized. These focused passes do not establish whole-project, full
native/browser, build-size, strict-structure or performance qualification.
