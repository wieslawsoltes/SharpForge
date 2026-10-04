# Semantically bound type rename preview

`prepareTypeRename(inputs, {uri, offset, name, newName, compilationOptions, signal,
maxFiles, maxCharacters, maxEdits})` previews source edits for exactly one named type.
It binds complete input syntax through SemanticAnalysis, indexes actual symbol
identities, and edits declarations, constructors and resolved type references. A
second semantic binding verifies that the proposed name does not capture another
reference. Same-spelled value members, other namespace types, comments and strings
are not renamed merely because their text matches.

The result is either `{available: true, symbol, edits}` or an explicit unavailable
diagnostic with no edits. Aliases, documentation cref, inactive source, incomplete
binding, missing/generated inputs, invalid identifiers and exceeded limits are not
silently omitted. Defaults bound input to 256 files/two million characters and
10,000 edits. Cancellation is checked during traversal. Generic and nested type
identities are supported where the full semantic compilation binds successfully.

`LanguageService.prepareTypeRename` attaches exact document versions, the complete
input snapshot and Workspace revision. `LanguageService.rename` delegates eligible
type declarations to this preview while retaining the previous value-symbol route.
`registerTypeRenameHandlers` registers the preview and existing refactoring rename
with the compiler worker protocol. The real worker bootstrap is a later integration
change; this batch exercises the actual protocol object with injected services.

The preview is pure and never edits files. The dependent Explorer command asks for
acceptance and applies file, source and project edits as one journal transaction.
Native or multiple-project contexts must supply a complete semantic context before
that host can offer the operation. No Roslyn-wide rename conformance is claimed.
