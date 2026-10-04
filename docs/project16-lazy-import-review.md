# Integrated workbench lazy-import review

SF-A19-T11.3 preserves the fixed-module lazy loading reviewed for workbench
review 04. The required static gate on that review layer passed after the
source-specific inventory correction `eec21669`: 2,299 files inspected and
linked, zero errors. That result belongs to the review layer and does not qualify
later integration sources.

The follow-up audit uses committed integration source `40b3dc80`. Its shared
metadata adapter replaces the two separate framework imports, reducing this
workbench scope to 29 literal imports in five files:

| Source under `apps/studio/workbench/` | Sites | Fixed destinations |
| --- | ---: | --- |
| `comment-tasks.js` | 1 | Public `@sharpforge/syntax` entry |
| `lazy-tools.js` | 5 | Adjacent Designer, Assembly Explorer, Disassembly, MSBuild and Project Wizard modules |
| `shell-models.js` | 2 | Public editor and designer entries for toolbox metadata |
| `shell-tools.js` | 20 | Closed tool-ID loader map into the adjacent `tools/` directory |
| `metadata/framework-model.js` | 1 | Public framework entry for registered type and member metadata |

`shell-models.js` adds explicit metadata catalog construction and
`shell-tools.js` passes metadata and workspace-edit callbacks to tool mounts.
Neither change modifies its import destinations. Code Definition and Object
Browser consume the shared catalog and have no remaining dynamic import; their
old inventory entries are removed. Each retained or moved site records the exact
current file hash, count and rationale in the existing policy inventory.
The initial scoped inventory check also found a final blank-line difference in
`comment-tasks.js`; source review confirmed its import and body were unchanged,
and its inventory hash now binds those exact integration bytes.

These destinations are repository-controlled module literals. Source text,
snippet contents, assembly metadata and tool instance IDs cannot form module
specifiers. Public package imports resolve through package entry points and are
rewritten to same-origin bundled assets by the browser build. Ordinary module
loading needs no JavaScript evaluation or script-element injection under the
shipped CSP.

The scanner, linker, CI workflow and policy assertions are unchanged. Future
file-byte or operation-count changes continue to fail until reviewed. The
integration inventory update is a source audit; it does not claim a repeated
full static gate, browser enforcement, runtime tests or standalone artifact
qualification for the later application composition.

After the source review and hash correction, the existing `checkDynamicUses`
function passed for these five inventory entries plus the two former import
files: seven files inspected, 29 sites observed and zero errors. It ran through
`node scripts/limited.js node --input-type=module` with the workbench entries
selected from the unchanged policy schema. The earlier scoped failure was the
documented final blank-line mismatch; no operation or rejection was suppressed.

## Shared intrinsic metadata and CPU capture follow-up

Committed integration source `a9aa167f`, including shell source `3b3f6546`,
changes three reviewed files. `framework-model.js` now combines registered
framework types with the shared core builtin shape metadata, canonicalizes
parameter signatures and removes duplicate members. Its single literal
`@sharpforge/framework` import is unchanged. `shell-models.js` creates the
session-owned execution capture service; `shell-tools.js` passes that service
to its tool mounts. Their two and twenty fixed lazy imports are unchanged.

The new `metadata/intrinsic-model.js` has one literal import of the public
`@sharpforge/bytecode` entry. It projects the registered builtin descriptions
through the shared pure owner, member-shape and parameter-type contracts. It
does not invoke guest instructions, load an inspected assembly as JavaScript or
derive a module target from source data. Its exact bytes, count and rationale
are now recorded alongside the three reviewed hash updates. This leaves six
workbench inventory entries covering thirty fixed literal imports.

This follow-up is source review only. No static gate, runtime test, build or
browser run was repeated; the root owns the next consolidated gate. The earlier
review and scoped-check results above keep their original revisions.

## Final synchronized-source inventory correction

The root's completed `npm run check` attempt at `96c7bc79` passed the manifest,
syntax and module-linking stages and identified only two source files with
mismatched dynamic-use inventory hashes. Main synchronization retained the
original reviewed final-newline form of `comment-tasks.js`; its one fixed syntax
import and function body are unchanged. Its inventory now binds the synchronized
bytes instead of the earlier extra blank line.

The editor package smoke file now follows the packaged modular CSS imports and
checks all six bundled keymap profiles, including ReSharper-like. Its three
JavaScript imports remain the literal `node:fs` and two public editor entry
loads. CSS import text is used only to read packaged stylesheet data and never
selects executable JavaScript. The inventory records those reviewed bytes and
this specific rationale. No source assertion or dynamic-code gate was changed.

The root owns the affected static-gate rerun. No check, test or build was run in
this inventory-only follow-up; the earlier failed attempt is not reported as a
passing complete `npm run check`.

## Final sparse metadata enumeration

Shell source `d46e8993` changes intrinsic metadata enumeration from the sparse
public dispatch array to `BuiltinMap.values()`, the public index of actual
registered descriptions. The descriptor projection and single literal
`@sharpforge/bytecode` import are unchanged. The inventory binds these exact
reviewed bytes and names the bounded descriptor enumeration in its rationale.
No dynamic-code rule, assertion or import destination changed.

The canonical command inventory was separately regenerated through the existing
`createWorkbenchInventory` function after the full A19 run exposed its missing
`keymap:resharper` command. The generated record now includes
`Keyboard: ReSharper-like (IntelliJ)`; the exact inventory assertion is preserved.
Neither correction ran tests or repeated a static gate. Root owns the affected
qualification after the complete combined A19/A20 run.
