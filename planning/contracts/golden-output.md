# Golden output guard

Task SF-A00-T19 (#437). Run `node scripts/planning/golden-output.js` to rebuild the
distribution and compare the committed SHA-256 inventory. Every examples `.cs`
file has source, syntax and diagnostics hashes; successfully compiled examples
also retain assembly and bytecode hashes. Project fragments and intentional error
examples remain explicitly not-emitted rather than disappearing from the corpus.
Every built distribution file is hashed, including worker bundles and CSS.

`node scripts/planning/golden-output.js --base BASE --labels seam` additionally
rejects edits to the committed lock, preventing a refactor from hiding differences
by updating its own expected result. All changes report before and after hashes
with exact paths. A29 owns workflow label forwarding and required-check wiring.

For an intentional reviewed output change, use
`node scripts/planning/golden-output.js --write` and commit the visible lock diff in
the behavior-change PR. A `seam` label forbids regeneration. A source refactor that
changes raw worker/distribution bytes is visible even if execution is unchanged;
it needs explicit review as a distribution output change, not an invisible hash
normalization. Preserve both syntax/assembly guards and the visible bundle diff.

Node/Git host tooling only: these hashes prove reproducibility and detect changes,
not semantic correctness or native qualification. The original corpus's compiler
diagnostics remain recorded limitations; complete project builds are independently
qualified by their own integration tests.
