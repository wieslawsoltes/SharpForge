# Versioned Outline reordering

`outlineReorder(workspace, {uri, version, sourceStart, targetStart, position})`
returns a `refactor.reorder` action with versioned workspace edits and the moved
member's selection. Positions use UTF-16 offsets; `position` is `before` or
`after`. The function never changes the workspace. The language/worker adapter
returns this action to the Studio host, which checks its document identity,
project, workspace generation and source version before applying it.

The lossless syntax tree identifies complete declarations, including their
leading documentation and trailing comments. A single replacement rearranges
the smallest contiguous member region. LF/CRLF, indentation, comments and the
relative order of all declarations other than the moved member are preserved.
Ordinary methods, constructors, operators, destructors and storage-free
properties/indexers can move within the same type. Fields, auto properties,
initializers, contextual `field` storage, attributed static parameterless void
initializer candidates, different containers, syntax errors and preprocessor
boundaries fail with an `OUTLINE_*` diagnostic. This deliberately avoids moving
storage declarations or module initializers whose order can affect execution.

The scan is linear in the syntax nodes plus the replaced source span. The
workspace's normal source-size limits apply. Same-member moves return an empty
edit list. Read-only/generated documents and stale versions fail before edits
are constructed. Source VM and direct JavaScript CIL equivalence are exercised
for a field-initialization fixture; external CLR and browser pointer interactions
remain separate qualification.
