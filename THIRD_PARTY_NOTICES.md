# Third-party notices

SharpForge's original source is MIT licensed. The optional alternative source-editor engine bundles selected **CodeMirror 5.58.3** sources under its MIT license, copyright Marijn Haverbeke and other contributors. The exact upstream notice is retained at `packages/editor/src/vendor/CODEMIRROR-LICENSE.txt` and included in the editor package and browser distribution.

The snapshot came from the offline nbclassic distribution installed in this build environment. It includes core, C-like/C# mode, Vim/Emacs/Sublime keymaps and selected dialog/search/bracket addons. UMD wrappers were adapted into a lazy factory scoped to the editor's owner document. File hashes, provenance and modifications are recorded in `packages/editor/src/vendor/manifest.json`. This is a legacy snapshot, not a claim to ship the latest upstream CodeMirror. Native Vim/Emacs, Vimscript, terminal/shell/plugin loaders and other unrelated nbclassic code are not bundled.

All optional engine code is local. No runtime CDN or remote keymap dependency is required. No font files or Microsoft Visual Studio assets are included. Product names describe compatibility/inspiration and do not imply affiliation.

## Portable PDB interoperability fixture

`tests/fixtures/portable-pdb/Documents.pdb` originates from the .NET runtime repository (MIT, .NET Foundation and Contributors), exact Git blob `ee0a1421085feeebf829e4f3b0ad972cc2e9c22c`. The upstream license and provenance are retained in that directory. This independent reader fixture is not a claim that all emitted symbols have been validated by native Microsoft tools.
