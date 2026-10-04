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
