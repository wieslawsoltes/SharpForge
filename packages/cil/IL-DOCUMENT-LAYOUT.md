# Explicit branch layout for editable IL documents

`assembleILDocument(text, { relaxBranches: true })` adapts branch widths after text
edits through `CilWriter.finishWithLayout`. The existing default keeps the exact
requested branch forms and rejects an out-of-range short branch. The new option
selects the shortest valid form for each short-capable branch, including `leave`.
Switch destinations remain symbolic until layout finishes.

Each method's existing `.eh` try/handler/filter labels and implicit end-of-method
label are translated through the returned offset map. Header flags, maxstack and
local-signature tokens retain the document values. The existing assembler still
requires every original method body, uses the metadata/resource scaffold, and
invalidates its existing signatures and custom debug maps as before.

This is the SharpForge IL dialect, not Microsoft ilasm syntax. It does not add new
metadata or user strings, infer stack sizes, verify prefix/exception transfer
legality, generate Portable PDB mappings, or activate default compiler relaxation.
The new layout path inherits its 16 MiB / one-million instruction and target limits.
Unsupported labels and invalid options produce CilError. The assembler remains a
bounded synchronous whole-document operation.

Focused default-compatibility, edited branch/switch, catch/filter/end-offset cases
and a four-method native execution capture are prepared; validation is pending its
serial slot. Direct CIL VM execution covers branch/catch/switch; filter execution
uses the native oracle because that VM capability remains separate. #2393 and
inherited A00 qualification remain open for the rest of IL-document work.
