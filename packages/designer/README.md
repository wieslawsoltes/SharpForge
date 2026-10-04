# @sharpforge/designer

Source-first WinUI design analysis, transactional authoring, document sessions, scene projection, source generation and live-delta
planning. MIT. The package has no DOM or native SDK dependency; Studio supplies the editor, surface, compiler worker and app hosts.

Ordinary C# is the authoritative source for supported declarative views. The design model is their editable projection, with explicit
ownership and compilation checks before source changes. Standalone `.sfdesign.json` documents remain available for portable model
authoring and generation, including staged features that require another execution target.

## Supported C# source editing

`probeDesignSource(text, uri)` recognizes a block-bodied `Create`, `InitializeComponent`, or `Main` that directly constructs supported
controls. It is a syntax-only compatibility gate; the full reader must still prove the construction and its editable statements.
Console-only programs, expression-bodied factories, and entry points that only call another view's factory do not qualify through
that gate. Open the file containing the actual construction.

`readDesignSource`, `analyzeDesignSources`, `planDesignSourceUpdate` and `CSharpDesignSession` read supported declarations, literal
assignments, object initializers, child/Items additions, attached setters, styles/templates and event subscriptions without executing
application code. Owned adaptive helpers round-trip width triggers, baseline resets and state overrides, including initial-width
calls and typed construction-local targets. Bound fields, helper methods and symbols can span partial C# files. Scalar updates
retain original UTF-16 source spans and literal
forms; structural edits require a proven owned region. Dynamic expressions, custom statements, lambdas and multiple event
subscriptions remain protected or navigation-only. Anonymous inline controls have narrower structural capabilities.

```js
import {CSharpDesignSession, DesignDocument} from '@sharpforge/designer';

// source is the current View.cs buffer, with a mapped control whose design ID is "button".
const session = new CSharpDesignSession(source, {uri: 'View.cs'});
const design = new DesignDocument(session.document);
design.setProperty('Width', 240, ['button']);
const plan = session.plan(design.value, source);
// Compile the candidate, verify every affected editor version, then apply its edits atomically.
session.commit(plan);
```

Studio performs candidate compilation, workspace/source version checks and atomic multi-file edits through its source service.
Source and design changes retain separate staged states; stale candidates are refused, and parse/compiler errors retain the last
valid preview with a blocking diagnostic. A successful syntax probe or visual preview does not authorize a source write.

## Sessions and authoring capabilities

| Area | Public capability and boundary |
| --- | --- |
| Per-document lifetime | `DesignerSession` and `DesignerSessionRegistry` own independent models, history, selection, async operations and resources by exact URI. Studio hosts Design, Split and Code within the same source document. Switching tabs retains the session; removal/reset disposes it. |
| View recovery | Mode, splitter orientation/ratio, zoom, scroll, selection, snap and bounded guide metadata recover per document. Live attachments and executable objects are excluded. Guide recovery does not change C# text or create undo entries. |
| Transactional editing | `DesignDocument` supports add/remove/move/duplicate/paste/group/ungroup, property changes, multi-selection geometry, Grid tracks, styles/templates and undo/redo. Validation rejects invalid types, values, references, hierarchy and oversized input before publishing a transaction. |
| Visual authoring | Studio supplies transformed drag/resize, snapping, guides, alignment/distribution, keyboard transforms, inline text, property/event editors and resource tooling. Sample data and preview settings remain designer metadata. |
| Adaptive source | Width-trigger states with supported property overrides round-trip through proved managed helpers and execute at the initial design width. Viewport changes require an application host call to the generated helper; native automatic triggers are unavailable. |
| Staged rich authoring | Gradients, bindings, resource/theme dictionaries, visual states and project-control metadata can be authored and previewed within their validated model contracts. Their source and execution support is narrower; unsupported writes remain staged with diagnostics. |
| Resource-class documents | The dedicated resource reader opens its supported generated `ResourceDictionary` factory/constant-markup profile. Studio offers preview, staged changes and candidate export. Applying those changes to C# requires native WinUI compilation, which this host does not provide. |

Standalone model APIs remain supported:

```js
import {DesignDocument, createDesign, generateDesignProject} from '@sharpforge/designer';
const design = new DesignDocument(createDesign('My application'));
const id = design.add('TextBox', 'canvas', {Name: 'Input', Text: 'Hello', Width: 240});
design.setProperty('Top', 240, [id]);
design.undo();
const files = generateDesignProject(design.value); // .sfdesign.json, .g.cs, Program.cs, csproj, slnx
```

## Preview and execution targets

**Inherited components are read-only previews.** A closed construction body with a source-proven direct framework base and instance
`Content`/`Child` assignment can be wrapped for inspection when the compiler reports only the recognized inheritance-profile errors.
The synthetic wrapper cannot generate source edits, create event handlers or establish successful compilation. Arbitrary base-class
execution and nested project-control composition are not supplied by this preview capability.

**The SharpForge target covers the registered runtime subset.** Default `generateDesignCode()` and `generateDesignProject()` emit
supported scalar/layout properties, solid brushes, styles, portable templates, ordered Items and Grid definitions. Rich features
outside that contract produce explicit generation diagnostics, including `SFD1872`. Explicit `target: 'winui'`,
`generateDesignXaml()` and resource-class export produce Microsoft WinUI source; they require a consumer-supplied platform project
and native compiler. Export is not native execution or a general bidirectional XAML designer.

**Live changes are scoped to one running app generation.** `designScene` projects a WinUIHost scene; `designFromScene` reads a managed
snapshot without executing user methods. `designPatch` and runtime `applyDesignPatch` preserve untouched values and enforce
session/revision checks with managed rollback. Source VM and direct CIL have supported live paths; each attachment still checks its
actual capabilities. Event/code changes use compiler Hot Reload. Studio can host up to eight independent app workers. Source edits
and code updates require a matching workspace receipt and exact captured compilation inputs; changed input membership requires
restart. An idle UI pause gates animation/input and is reported separately from a debugger-paused managed thread.

## Model limits and qualification

| Limit | Bound |
| --- | --- |
| Design graph | 5,000 nodes, including the root; visual-tree depth is bounded to 100. |
| Grid definitions | 64 tracks per axis. |
| Undo history | Defaults to 100 entries and a 32 MiB retained-snapshot budget; configurable within the document contract. |
| View state | Zoom 10–800%; guide/grid spacing 0.25–1,024 design pixels; up to 256 named guides. |
| Compatibility input | At most 2,000,000 UTF-16 code units per source file. |

The 5,000-node bound is a model capacity, not a browser frame-rate guarantee. Final integrated browser correctness, accessibility,
responsive-layout and interaction-performance qualification is pending. Recorded Node source/model/geometry measurements do not
establish the browser's 16 ms interaction budget. Source VM, direct CIL, Rust native/Wasm and native WinUI results must be reported
separately; an unavailable or skipped target is not a passing target.

See [document sessions](DOCUMENT-SESSIONS.md), [authoring and target boundaries](A18-AUTHORING.md),
[visual editing](visual-authoring.md), [running-app source ownership](APP-SOURCE-OWNERSHIP.md) and
[qualification evidence](docs/qualification.md) for the detailed contracts and recorded measurement scope.
