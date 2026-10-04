# Source-preserving project and solution editing

`parseXmlCst(source, options)` returns a concrete syntax document with exact
source spans for elements, attributes, text, comments, CDATA, and processing
instructions. `serializeXmlCst(document)` is byte-for-byte identical at the
JavaScript string level, including BOM, CRLF, attribute quoting, namespace
prefixes, and comment placement. Native workspace encoding preservation happens
at its byte-oriented read/save boundary. DTDs and external entities are rejected.
Length, node-count, depth, and cancellation bounds apply while parsing.

`applyXmlEdits(source, edits)` accepts nonoverlapping `{start, end, text, expected?}`
spans. Offsets use UTF-16 code units. The optional expected old span rejects stale
edits. It parses the complete result before returning; malformed edits never
produce a successful partial plan.

`editProjectProperty(source, {name, value, condition, propertyCondition})` and
`editProjectItem(source, {itemType, identity, operation, metadata, condition})`
return `{text, edits, undo}`. The inverse spans recover the exact original
document. Item operations are `Include`, `Remove`, `Update`, and `Delete`.
`null` property or metadata values remove that definition. Metadata already stored
as an attribute stays an attribute; existing child elements stay child elements.
New metadata is written as child elements. Structured metadata or duplicate
definitions produce explicit ambiguity errors.

Edits target direct, literal, unconditional definitions unless an exact group
condition is selected. Imported definitions, wildcard identities, conditional
item definitions, and unrelated groups remain intact. Deleting an item removes
its now-empty generated group but does not remove unrelated empty groups or
comments. SDK compile membership uses one literal removal override and coalesces
repeated exclude/include toggles back to the original default membership. An
explicit Import requires ordered Remove/Include overrides because its membership
effects cannot be inferred from this source alone.

The explorer-compatible wrappers are `sourcePreservingProjectMembership` and
`sourcePreservingNamedProjectItem`. The native `applyProjectEdit` helper uses the
workspace's optimistic SHA-256 save guard. On a disk mismatch it returns
`applied: false` and a base/local/remote conflict record (`SFP2105`). It does not
write conflict markers into XML.

Solution parsing retains unsupported .fsproj, .vbproj, .vcxproj, and other project
entries as unloaded records with reasons. C# project loading is separate from
retention. Legacy solution GUIDs, nested folders, dependencies, solution items,
and unknown sections survive classic solution serialization.

The MSBuild package exposes `readSlnxConfigurations`, `readSlnConfigurations`,
`selectSolutionProjects`, `createSolutionConfigurationManager`,
`solutionProjectBuildRequest`, and `writeSln`. Mapping separates Configuration,
Platform, Build, and Deploy; project rules override type defaults in source
order. The selected solution produces per-project global properties for native
requests and `ProjectSystem`'s `projectProperties` overlay. Excluded projects
remain visible in the configuration-manager model.

The default mapping follows the reference
[vs-solutionpersistence rules](https://github.com/microsoft/vs-solutionpersistence/blob/main/src/Microsoft.VisualStudio.SolutionPersistence/Model/ProjectTypeTable.BuiltInTypes.cs):
CLR projects use AnyCPU; VC Any CPU uses x64 and VC x86 uses Win32. Custom project
type rules and base types are supported. No UI-specific state lives in the
configuration model.
