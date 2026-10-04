# Classic solution data contract

`readLegacySolution(text, path)` reads bounded classic `.sln` data without loading
projects or executing tools. `path` is a granted logical workspace path. The
reader returns the solution name/path, folders and folderRecords, mixed project
records, logical items, C# projectPaths, globalSections and diagnostics.

Every non-folder project remains in `projects` and `items`, including C++ and
F# entries. C# project paths appear in `projectPaths`; other types are marked
`supported: false`, `unloaded: true`, with a native-toolchain reason and `SFP1301`
warning. Records retain normalized IDs/types, names, relative-path source text,
folder parent IDs, dependency IDs and unknown project sections. Global section
names, scope and content are retained for the separate configuration mapper.

Solution folders retain nesting and solution items. Duplicate IDs, missing or
invalid folder parents, cycles, unsafe workspace paths, nested project
declarations and unterminated projects/sections fail explicitly. Text is limited
to 4 MiB of JavaScript string code units and the project/folder table to 10,000
nodes. This structural reader does not validate every Visual Studio solution
extension or resolve dependency identities against external repositories.

`convertLegacySolution(text, path, target?)` produces `{ path, text, warnings }`
for an explicit `.slnx` conversion. It retains unsupported projects and uses paths
relative to the destination. It does not write files. Configuration mappings
remain in the original `.sln`; that limit and native-only projects are reported
in warnings. The caller chooses whether to save the new file.

The existing `legacy-solution.js` module remains a compatibility re-export. Its
implementation moved into a formatted module because the old entry is frozen by
the repository's structure baseline. The portable ProjectSystem placeholder
integration and native configuration selection consume this reader in dependent
PRs; parsing alone does not load or build unsupported project types.
