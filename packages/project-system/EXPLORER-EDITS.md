# Source-preserving Explorer paths and membership

Explorer project membership and named-item wrappers delegate to the shared XML CST
editing foundation. Literal includes/removes respect the existing source and import
order; comments, unrelated metadata and expressions are retained.

`rewriteProjectPath(text, {documentPath, oldPath, newPath, newDocumentPath})` decodes
XML entities before comparing literal path attributes. `rewriteProjectPaths` takes
a complete `mappings` array so every original path is rewritten once, even during a
multi-file relocation. The new document directory rebases unaffected relative
references as needed. Replacement values retain quote style and escape ampersands
and apostrophes. Comments, CDATA, property/item expressions and non-path package or
assembly identities remain intact. Invalid XML/entities reject before returning
any edited source.

Solution XML helpers add, move and remove projects, logical solution folders and
solution items. Moving a project preserves its complete configuration/dependency
element; changing a logical folder does not move physical files. These helpers
accept `.slnx` XML, not legacy `.sln` text. The separate legacy solution editing
service owns that format.

All operations are pure source transformations. Disk preflight, journal history,
provider writes and UI commands belong to the dependent Explorer operation batch.
The existing hierarchy remains unchanged here; its keyed model follows separately.
