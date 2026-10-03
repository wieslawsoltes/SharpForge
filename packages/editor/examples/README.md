# Standalone editor examples

These pages instantiate `CodeEditor` directly. They require no Studio window,
compiler service or workspace service. The virtual-view example includes wrapping,
whitespace, folding, bookmarks, shared split views and loading 500,000 lines. The
keymaps example switches the same model between Visual Studio, VS Code, Sublime,
Emacs and Vim profiles.

## Run the built distribution

From the repository root, build once after the complete implementation scope:

```sh
npm run build
node scripts/serve.js
```

Open either page on the server's displayed origin (port 4173 by default):

- `/packages/editor/examples/virtual-view.html`
- `/packages/editor/examples/keymaps.html`

The build copies the editor, text and syntax packages into `dist/packages` and
rewrites their package imports to relative module URLs. The same rewrite visits
`editor/src/features/search-worker.js`, so large regular-expression search can
load its text dependency inside a real module worker. The worker stays an ES
module and does not need a classic-worker build contribution.

These pages use external scripts and styles, so the production server can serve
them with its normal Content-Security-Policy. Serve the built pages rather than
opening the source HTML through `file:` or a source-only static server. Module
workers do not inherit page import maps.

## Embed the package elsewhere

Import `CodeEditor` from `@sharpforge/editor` and include
`@sharpforge/editor/editor.css`. Configure the host bundler to preserve or bundle
`new URL('./search-worker.js', import.meta.url)` as a module-worker asset and to
resolve the declared text and syntax dependencies. `EditorSearchSession` also
accepts an injected `workerFactory` for hosts with a separate worker pipeline.

Language intelligence is available when the embedding host supplies the data
providers described in [insights.md](../docs/insights.md). The keymaps example
reports an explicit error when a workspace command needs a provider.

Browser fixtures are authored separately in `tests/browser_a20_view_test.py` and
`tests/browser_a20_insights_test.py`. They use built packages and the supported
browser launcher. Their existence does not establish a completed browser run.
