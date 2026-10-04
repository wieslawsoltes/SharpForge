# Exact image preservation for editable IL documents

For supported IL-only images, the default `formatILDocument` →
`assembleILDocument` → `formatILDocument` round trip retains the entire document, including its `.image` scaffold, when
every visible method describes its original body. Assembly still parses and
compiles every required method. Missing methods, duplicate methods, malformed
operands, invalid locals, exception ranges and unsupported image layout remain
errors. There is no omitted-body fallback.

The image writer compares the compiled code bytes, maximum stack, local-signature
token, initialization flag and ordered exception-clause fields with the original
body. A match retains its original RVA and physical encoding, including tiny/fat
headers, small/fat exception sections and padding. Changed bodies are appended and
receive new RVAs. New string literals still use the existing bounded #US append
and metadata-root relocation path.

When no body or heap changes, the result owns a byte-identical copy of the input
image and has no rewrite warnings. Existing checksums, signature fields, debug
maps, metadata and resources remain untouched. Preserving those bytes does not
authenticate their signatures. An actual edit retains the existing behavior:
signature reservations and directories are cleared, #SF is invalidated, and
rewrite warnings are returned. Explicit branch relaxation can intentionally
change branch widths; subsequent round trips of that result are stable.

## Floating operands

Negative zero is printed as `-0`, preserving its distinct bit representation in
both `ldc.r4` and `ldc.r8`. Replacing that text with `0` changes the instruction.

The dialect's `NaN` text does not expose a payload. Assembly preserves an original
NaN payload only when the validated visible operand is `NaN` and its label and
exact floating opcode match an original decoded NaN instruction in that same
method. The opcode and all other operands are compiled normally; only those
four or eight operand bytes are retained. This also works when an insertion or
branch relaxation relocates the matching label. A new or renamed NaN instruction,
or a change between `ldc.r4` and `ldc.r8`, uses the normal writer's NaN encoding.
Changing the operand to a finite value always replaces the old payload.

This rule adds no raw-float syntax and does not use numeric equivalence as a
substitute for exact body comparison. General metadata editing, Microsoft ilasm
syntax and native execution compatibility remain separate capabilities.

## Regression and qualification scope

The fuzz adapter now compares the complete canonical text with no `.image`
normalization. `IL_DOCUMENT_EXACT_ROUNDTRIP` identifies this check. Generated-text
assembly failures and any exact inequality remain findings. Small authored seeds
include negative zero and a noncanonical NaN payload.

Focused regressions cover byte identity, physical encodings, public-sign/debug
preservation, real-edit invalidation, partial method rewrites, header/EH edits,
negative validation and floating payload boundaries. The no-change profile test
in `managed-il.test.js` now makes a real edit before expecting #SF invalidation;
an unchanged image has no stale method map to invalidate.

Validation is pending at the implementation revision. The focused commands are:

```sh
node scripts/limited.js node --test tests/a03-il-document-preservation.test.js tests/a03-il-document-floats.test.js
node scripts/limited.js node --test tests/managed-il.test.js tests/a03-05-il-document-layout.test.js tests/a03-05-il-document-strings.test.js
node scripts/limited.js node --test tests/conformance/fuzz/text-targets.test.js tests/conformance/fuzz/protocol-sequences.test.js
```

The authored execution regression uses the JavaScript source-profile VM and direct
CIL VM. Native CLR, browsers and Rust qualification have not been run for this
change. The additional comparisons and NaN indexing are linear in method code,
instructions and exception clauses; no performance improvement is claimed.
