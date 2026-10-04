# Reviewed offline regression inputs

The normal A29 Node manifest runs `../fuzz/retained-corpus.test.js`. It verifies
and replays every hash-named JSON record in this directory through the same fixed
adapter used by the campaign. The first reviewed record preserves a malformed
Portable PDB embedded-source DEFLATE stream observed at published commit
`ad0ea92f16bddcbcfecce884b93579fe94617c04`. The original public reader threw
`Error: Reserved DEFLATE block`; the corrected symbol contract rejects it through
`SymbolError` with `SF_SYMBOL_INVALID_COMPRESSION`. The original record, input,
source identity, finding and effective budgets are unchanged. An empty corpus
still produces an explicit skip, which is not parser qualification.

Campaign findings are written under the explicitly selected `artifacts/fuzz`
output, together with the exact source, literal input, original finding and
effective budgets. Preserve the original report before preparing a product fix.
After the owning area fixes and reviews the defect, promote the unchanged
hash-named JSON record here. Replay requires the finding to be resolved to an
accepted input or a controlled rejection. Unsupported, cancelled, incomplete,
changed-input and continuing-finding outcomes fail the regression.

Do not rename the record, edit its checksums, relax its budgets or add a passing
expectation for a finding. Tooling self-checks are rejected as production corpus
records. Target names are fixed; corpus content never selects executable code,
modules, host paths or network endpoints.
