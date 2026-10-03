# Explorer Workshop

Open the containing directory in Studio and select `ExplorerWorkshop.slnx`. The App produces `42` and `42` in the portable compiler. Library uses explicit source includes; App contains linked source, a deliberately noncompiling `.cs` note with Build Action None, a Content item and an empty virtual project folder.

Expand source files for members. Use context menus to inspect Properties, change Build Action, exclude/include, copy/move ordinary items, and add a project to the existing src solution folder. File operations affecting project XML preserve unrelated comments. Use the local host to change actual disk structure; browser imports are in-memory and can be exported as a `.sharpforge.json` workspace bundle.

`Tools/Arithmetic.dll` is the same independently hand-authored ordinary managed fixture supplied under examples/managed. It can be opened from the explorer without replacing the current project. Native SDK execution is a separate unqualified gate in this environment.
