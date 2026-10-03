# Seeded differential corpus

The schema is `README-format.json`; `corpus.json` lists source files with `Main`
entry, literal stdin, declared capabilities, bounded integer seed, pinned language
version and explicit normaliser tags. The seed is always part of fixture identity.
`{{seed}}` is substituted numerically before either compiler sees the same source.
Use explicit seeded `Random` constructions; unseeded randomness is rejected.

The loader rejects missing seeds, unknown fields, path traversal, escaping symlinks,
wall-clock references without `wall-clock`, and unordered collection use without
`unordered-lines`. Detection is deliberately conservative and may require a tag
for comments mentioning these APIs. This is a deterministic test profile, not a
proof that arbitrary C# cannot hide nondeterminism; repeated native and VM runs
independently detect observations that still differ.

`newlines` converts CRLF/CR to LF. `float-format` canonicalises only whole numeric
output lines, preserving negative zero and full IEEE Number precision. It never
rewrites numbers inside prose. `exception-text` removes only the standard System
prefix, terminal period and surrounding whitespace. `wall-clock` replaces only
lines of the form `clock=<number>`. `unordered-lines` explicitly declares every
output line unordered and sorts them; do not apply it to ordered protocols.
Raw output always remains in the report beside normalized observations.

`known-differences.json` lists reviewed exact input/observation fingerprints and
reasons. No command updates this file automatically. A changed source, seed,
normaliser, status, engine pair or observable result creates a new difference;
unclassified differences always fail. A known difference is a retained failure,
not a parity pass. Resolved entries appear separately so reviewers can remove them.
