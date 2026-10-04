# Semantic type rename preview

`prepareTypeRename(inputs, options)` is an explicit, mutation-free compiler API for language services.
Inputs are complete `{uri,text,version?}` compilation files or existing `parse()` results. Options include
`uri`, declaration `offset` (or `name` when offset is null), `newName`, `compilationOptions` and an `AbortSignal`.
The default limits are 256 files, 2,000,000 source characters and 10,000 edits. Exceeding a limit returns `SFL2405`.

The result is `{available:true, symbol, edits:[{uri,start,end,newText}]}` or
`{available:false, reason, diagnostic, edits:[]}`. Offsets use UTF-16 code units. The function never changes inputs.
Named-type identities and references come from the existing lossless semantic analysis, including partial declarations,
constructors, type annotations, generic arguments, creation expressions and static type receivers. Comments, strings,
and references to different symbols with the same spelling are preserved. A second semantic binding of the proposed
source rejects name capture or newly invalid code with `SFL2403`; identifier validation uses `SFL2402`.

Incomplete semantic binding, using aliases, documentation `cref`, inactive preprocessor source, generated edits and
unclassified matching identifiers return `SFL2401`. These cases need more reference binding coverage before a type
rename can be offered. The API is a source refactoring and does not rewrite string-based reflection or external consumers.
It operates on one compilation context; callers must supply complete inputs and enforce editable workspace boundaries.

`LanguageService.prepareTypeRename(uri,offset,newName,{name?,signal?})` wraps the compiler result in document versions
and full input snapshots. Studio invokes this service in its compiler worker, admits only one loaded project/target
context, and retains every input snapshot through the confirmation dialog. Accepted edits, physical file rename and
project XML references are one workspace journal transaction, with one undo/redo entry. Declining the optional offer
renames only the file. Native, separate-project and additional-target contexts have visible unsupported reasons.

Binding is bounded by the compiler's existing limits. Reference indexing is linear in bound/syntax nodes; source edits
are sorted per file, and offset remapping uses binary search in prefix deltas. No token text determines symbol identity.
