# Project 16 a5 changed-source inspection

The final bounded inspection found no new file-dimension violations in **37 changed source files**: 17 files matching the
repository structure gate's source filter and 20 supplemental test, fixture and Python files. The original three changed
legacy-line findings are retained separately. This is not a whole-repository structure gate or runtime qualification.

## Sources and recorded operations

Both inspections compare against `c13aa0fd9d27df28b3708bb83d914a04c20a5c7c`.

| Operation | Inspected source | Tree | Result |
|---|---|---|---|
| Initial dimensions and Python AST | `e89257052957f4c736512e9c2b46162bb6f23eae` | `9e33eca9a91361201b2e14fea3cded5cbd584d88` | Official subset: 0; stricter introduced-line check: 3 findings; Python parsed |
| Final source dimensions | `a5977d0e0713997766e2d16101f44bc2a776a114` | `cf7a61b6964b794d1b0128cbaffafd180b643ef0` | 0 file-dimension findings; Python AST not rerun |

The initial operation ran from `2026-10-04T06:10:35.219080+00:00` to `2026-10-04T06:10:35.643899+00:00`; its exit code was 1 because
of the stricter introduced-line findings. The final operation ran from `2026-10-04T06:17:08.138987+00:00` to
`2026-10-04T06:17:08.401459+00:00` with exit code 0. Exact commands, script hashes, Git reads and per-file SHA-256 hashes are retained:

```sh
python docs/evidence/project16-a5-changed-source/inspect.py > docs/evidence/project16-a5-changed-source/inspection.log 2>&1
python docs/evidence/project16-a5-changed-source/reinspect.py > docs/evidence/project16-a5-changed-source/reinspection.log 2>&1
```

Timing is captured inside each script around its recorded work. The commands only read pinned Git blobs, measure source
text, write evidence, and, in the initial operation only, call `ast.parse`. They do not import repository Python modules.

## Dimensions and the resolved finding

The official-filter subset follows `scripts/quality/check-structure.js`: roots `packages`, `apps`, `scripts`, `rust`;
extensions `.js`, `.mjs`, `.rs`, `.css`; and the gate's generated/vendor/fixture exclusions. Limits are 500 split-LF
lines, **40,000 bytes**, and 160 UTF-16 code units per line. The pinned historical baseline is unchanged.
The supplemental 20 source files are outside that official filter and were checked explicitly for file size and introduced
long lines. Their largest line count is 243, largest file is 14,900 bytes, and maximum line length is 145.

At the initial source, modified `compiler.worker.js` lines 39, 41 and 48 measured 518, 308 and 562 UTF-16 units.
The historical official gate subset had zero violations because its existing maximum did not grow; the additional
changed-line comparison correctly retained those three findings. Docking's narrow correction formats those statements
and replaces two one-element registration loops with direct literal registrations. It is not described as whitespace-only.

| Frozen file | Base bytes / lines | Initial bytes / lines | Final bytes / lines | Final historical maximum line |
|---|---:|---:|---:|---:|
| `apps/studio/compiler.worker.js` | 8,553 / 53 | 8,394 / 52 | 8,553 / 83 | 817 |
| `apps/studio/studio.js` | 104,451 / 747 | 104,362 / 747 | 104,362 / 747 | 2,140 |

The compiler worker's readable reflow increases logical lines but stays below 500 and does not increase bytes against the
comparison base. Existing unchanged long lines remain historical, not new passes at 160 characters. No new long lines,
file-size violations or frozen byte growth remain in the scoped final source. Of the original 37 source files, only the
compiler worker changed between the two inspections. Function length, parameter counts, nesting and semantic architecture
were not inferred by this file-dimension inspection.

## Python and evidence boundaries

`tests/browser_editor_budgets_test.py` is the only changed Python file. Python `3.12.14` successfully parsed its
exact `e8925705` blob with SHA-256 `a3f52ab661f54aaac83930814bc09e171a86c57908c203b50a5c649dd8c9ae80`. Its bytes are unchanged at the final source;
no second AST operation is claimed. The initial result remains attributed to `e8925705`.

The root publication owner reports integration commit `ba279d9742a6c5c83f85d7e90ed3307a6eaf1cc8` with the same final tree,
and public integration `c586a63517efb7c19a60ead0c54fb128dd566d03`. That supplied mapping is recorded separately from
locally inspected Git identities; this work performed no remote fetch or hosted execution.

The [evidence manifest](evidence/project16-a5-changed-source/manifest.json) hashes both scripts, both raw reports and logs,
exact invocation records, and the supplied publication mapping. The [initial report](evidence/project16-a5-changed-source/inspection.json)
retains its findings; the [final report](evidence/project16-a5-changed-source/reinspection.json) records their resolution.
No baseline, product or test source was edited by this evidence work. No Node process, test, build, benchmark, browser,
whole legacy structure sweep, or Python test suite ran. Unrelated untracked work and prior branches were preserved.
