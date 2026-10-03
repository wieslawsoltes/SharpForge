# Explorer, keymaps and breakpoint examples (0.8.0)

Open these three examples from Studio’s Examples panel. `manifest.json` is the regression-test source; the matching source files are provided for disk workflows. All three compile and run through IR, canonical reload, direct CIL and exported/reassembled IL in `release08-examples.test.js`.

`breakpoint-workbench`: set a breakpoint at `total += i + 1`, configure a condition (`i == 1`), a hit count, or a logpoint in the Breakpoints panel. Continue to the next hit; restart to reset the session; step backward to replay retained history. Removing the last breakpoint must allow the program to finish.

`editor-keymaps`: change the persisted profile in Settings. Visual Studio is the default. Alternative profiles share the same source buffer, compiler services and debugger read-only state. Vim uses the bundled CodeMirror keymap, not a native Vim process or Vimscript environment.

`explorer-members`: expand the Models folder and a source file, then activate a property or method to navigate to its bound source span. File-system actions are unavailable on member nodes. Try file Copy/Paste, rename and Undo before further edits; undo refuses to overwrite newer changes.

The disk solution `../projects/ExplorerWorkshop/ExplorerWorkshop.slnx` adds explicit Compile/None/Content/Folder items, a linked file, multiple projects, and a managed DLL for inspection. Browser project references are source-combined, not independently linked assemblies.
