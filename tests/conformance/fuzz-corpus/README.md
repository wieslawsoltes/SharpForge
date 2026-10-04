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

Two retained PE inputs preserve malformed UTF-8 metadata version strings from
seed 1, cases 88 and 463, at published commit
`bf85020e6024cdd679a0234d9f050ca7dedddf53`. The public loader and inspector originally
threw `TypeError: The encoded data was not valid for encoding utf-8`. The corrected
Node decoder rejects that exact native encoding failure through `CilError` with
`Invalid UTF-8 text`. The original input bytes, source identity, finding, budgets
and hash-named records are unchanged. These three production records are replayed
by the normal manifest; their presence does not qualify other engines or inputs.

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
