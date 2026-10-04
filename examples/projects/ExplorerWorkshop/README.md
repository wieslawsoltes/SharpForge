# Explorer Workshop

Open the containing directory in Studio and select `ExplorerWorkshop.slnx`. The App produces `42` and `42` in the portable compiler. Library uses explicit source includes; App contains linked source, a deliberately noncompiling `.cs` note with Build Action None, a Content item and an empty virtual project folder.

Expand source files for members. Use context menus to inspect Properties, change Build Action, exclude/include, copy/move ordinary items, and add a project to the existing src solution folder. File operations affecting project XML preserve unrelated comments. Use the local host to change actual disk structure; browser imports are in-memory and can be exported as a `.sharpforge.json` workspace bundle.

`Tools/Arithmetic.dll` is the same independently hand-authored ordinary managed fixture supplied under examples/managed. It can be opened from the explorer without replacing the current project.

The shared `Counter` type is public in both partial declarations because App consumes the separate Library assembly.
The native SDK 10.0.201 fixture builds both assemblies and verifies `42` followed by `42`; reverting Counter to internal
must produce CS0122. This boundary is qualified on Linux x64 with Node 22.23.3 and Node 26.10.0 in
`tests/a23-native-explorer-boundary.test.js`. Other native platforms remain separate qualification cells.
