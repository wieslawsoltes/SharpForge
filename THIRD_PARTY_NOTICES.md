# Third-party notices

SharpForge's original source is MIT licensed. The optional alternative source-editor engine bundles selected **CodeMirror 5.58.3** sources under its MIT license, copyright Marijn Haverbeke and other contributors. The exact upstream notice is retained at `packages/editor/src/vendor/CODEMIRROR-LICENSE.txt` and included in the editor package and browser distribution.

The snapshot came from the offline nbclassic distribution installed in this build environment. It includes core, C-like/C# mode, Vim/Emacs/Sublime keymaps and selected dialog/search/bracket addons. UMD wrappers were adapted into a lazy factory scoped to the editor's owner document. File hashes, provenance and modifications are recorded in `packages/editor/src/vendor/manifest.json`. This is a legacy snapshot, not a claim to ship the latest upstream CodeMirror. Native Vim/Emacs, Vimscript, terminal/shell/plugin loaders and other unrelated nbclassic code are not bundled.

All optional engine code is local. No runtime CDN or remote keymap dependency is required. No font files or Microsoft Visual Studio assets are included. Product names describe compatibility/inspiration and do not imply affiliation.

## Portable PDB interoperability fixture

`tests/fixtures/portable-pdb/Documents.pdb` originates from the .NET runtime repository (MIT, .NET Foundation and Contributors), exact Git blob `ee0a1421085feeebf829e4f3b0ad972cc2e9c22c`. The upstream license and provenance are retained in that directory. This independent reader fixture is not a claim that all emitted symbols have been validated by native Microsoft tools.

## Supply-chain validation schemas

The official CycloneDX 1.6 JSON Schema, its SPDX license identifier schema and the
JSON Signature Format 0.82 schema are retained under
`planning/qualification/supply/cyclonedx/`, from CycloneDX/specification commit
`1ce97b2a7b8cf2429da248560d2aa671c6bce74a`. CycloneDX contributors license these
schema files under Apache-2.0; the retained LICENSE and origin.json identify the
exact source URLs and SHA-256 values. JSF credits Anders Rundgren/OpenKeyStore in
its retained schema comment. These files are validation tooling, not product code.

## Reviewed repository assets

The exact repository icons, example archives, generated managed assemblies/symbols
and documentation screenshots are enumerated in
`planning/qualification/supply/licenses.json`, with their source revision, hashes
and repository MIT license. This records the repository's existing license
declaration; it does not independently establish third-party authorship. New assets
require an explicit origin/license record. The separate Microsoft Documents.pdb
fixture and CodeMirror files retain their third-party notices above.

## Python qualification tooling

Playwright 1.57.0 (Microsoft, Apache-2.0), jsonschema and its attrs,
jsonschema-specifications, referencing and rpds-py dependencies (MIT), PyYAML (MIT),
pyee (MIT), greenlet (MIT AND PSF-2.0) and typing_extensions (PSF-2.0) are installed
only for tests and gates. They are not embedded in SharpForge's runtime or published
workspace packages. Exact selected versions, official PyPI origins and all wheel
hashes are in `planning/qualification/supply/python-lock.json`. Their installed
wheel distributions retain their own license notices. jsonschema validates the full
official schema; PyYAML parses actual workflow semantics instead of approximating
YAML with a regular expression.

## Captured browser trace source licenses

The exact Project16 trace archives recorded in `planning/qualification/supply/licenses.json` contain unchanged pyee 13.0.1 `base.py` and `asyncio.py` (MIT), CPython 3.12.14 `contextlib.py` (PSF-2.0), and SharpForge source and generated reports (MIT). The a4 archive also retains Unicode 16.0.0 grapheme tables in its generated language-worker bundle (Unicode-3.0). The complete source notices are retained in [trace-python.txt](planning/qualification/supply/licenses/trace-python.txt). These are recorded evidence archives; listing them does not assert that their captured test runs passed.

## A05 browser qualification captures

The 44 exact PNG captures listed in the supply catalog are retained qualification
evidence. Thirty-six record, or attempted to record, the official Speedscope 1.24.0
UI (MIT, copyright 2018 Jamie Wong) with repository profile data, and eight record
the repository's MIT-licensed CSP fixture. Their original browser reports and
sessions retain exact capture provenance and failed observations. The upstream MIT
and Source Code Pro OFL notices are retained in the [source qualification area][a05-notices].
No Speedscope application or font binaries are shipped with these captures; source
licensing and evidence origin do not imply that a captured run passed.

These grounded origin/license declarations are proposed maintainer-review material,
explicitly marked `proposed-maintainer-review` in the catalog. Machine coverage and
hash validation do not assert independent authorship discovery, human approval or
release sign-off. The [origin review record][a05-review] explains the exact source
licenses and the OFL's exception for documents created using the font.

[a05-notices]: https://github.com/wieslawsoltes/SharpForge/tree/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence-relocations/licenses
[a05-review]: https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence-relocations/png-origin-review.md
