# SharpForge 0.6 examples

The eight source examples are also in Studio’s Examples tool. `manifest.json` records source text, expected output and extension configuration. Import the `.sharpforge.json` versions for generator/analyzer examples; a standalone generated-model `.cs` file deliberately needs its schema generator.

The checked-arithmetic, using-resources, using-failure and constant-patterns examples run through IR, canonical CIL, ordinary direct CIL, and exported/reassembled IL in the test suite. Additional examples exercise structural refactorings, immutable schema generation, unreachable-code warnings, and heap-storage writes around explicit collection and finally.

For ordinary DLL/EXE instruction debugging, open `../managed/StorageWrites.exe`, enable **Record IL history**, and choose **Debug IL**. Right-click a local or object/array child and choose **Break on write**. Use Step back or Reverse continue in MSIL Disassembly. Reverse history is bounded and restores managed state, not external side effects.

For checked project settings, open `../projects/CheckedResources/CheckedResources.slnx` from a folder grant.

Editor walkthrough: Ctrl+Alt+Right expands a syntax selection, Ctrl+Alt+Left shrinks it. Alt+Left/Right navigates document locations. Ctrl+. previews refactorings; edits are version-checked and candidate-compiled before application. Highlighting renders only a line viewport; the native textarea and per-revision lexer still process the whole document.
