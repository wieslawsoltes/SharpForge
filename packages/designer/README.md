# @sharpforge/designer

Transactional, data-only code-first WinUI design documents, validated editing, scene projection, C# generation and live-delta planning. MIT. No DOM or native SDK dependency.

```js
import {DesignDocument, createDesign, generateDesignProject} from '@sharpforge/designer';
const design = new DesignDocument(createDesign('My application'));
const id = design.add('TextBox', 'canvas', {Name: 'Input', Text: 'Hello', Width: 240});
design.setProperty('Top', 240, [id]);
design.undo();
const files = generateDesignProject(design.value); // .sfdesign.json, .g.cs, Program.cs, csproj, slnx
```

`validateDesign` rejects unsupported types/properties, non-data input, cycles, duplicate identities, incompatible resource targets and bindings, oversized trees, and invalid hierarchy. `DesignDocument` exposes transactional change, add/remove/move/duplicate/paste/group/ungroup, multi-selection geometry, Grid tracks, styles/templates and undo/redo. A rejected transaction leaves the document unchanged.

`designScene` produces a WinUIHost scene. `designFromScene` captures a running managed scene without executing user methods. `designPatch(before, after)` plans explicit property/tree/template changes without resetting untouched inputs. `applyDesignPatch` from `@sharpforge/runtime` applies a delta with a session/revision check and managed-state rollback. Source and direct-CIL sessions are supported. Event-code changes require a separate compiler Hot Reload operation.

Limits: 1,000 design controls, 100 levels, 64 tracks per axis, 500 parts per template, 100 undo entries. The design model and registered source providers define the supported authoring profile. Native WinUI compilation, unrestricted dependency-property registration, native CLR updates and arbitrary C# or XAML execution remain outside this package. See the application's Edit and Continue / Designer guide for the supported profile.

## 0.13 C# source synchronization

`readDesignSource(text, options)`, `planDesignSourceUpdate(analysis, document)` and `CSharpDesignSession` map supported declarative C# to the design model without executing it. Scalar updates use original UTF-16 spans; structural edits require a proven construction region. Dynamic expressions and custom statements are preserved/protected. Host applications must compile candidates and compare document versions before applying edits. Studio performs those checks and preserves its original editor.

```js
const session = new CSharpDesignSession(source, {uri: 'View.cs'});
const design = new DesignDocument(session.document);
design.setProperty('Width', 240, ['button']);
const plan = session.plan(design.value, source);
// Compile plan.text, verify editor version, then apply plan.edits.
session.commit(plan);
```

Source edits to handlers outside the construction region remain user-owned.

## Literal XAML source synchronization

`readDesignXaml`, `planDesignXamlUpdate` and `XamlDesignSession` map literal XAML to the same design document and scene projection used by C#. The generated Page, Window, UserControl and ContentDialog pairs can be opened directly in the designer. Supported properties come from the existing framework manifest; scalar values, enum names, attached layout properties, text content, visual child collections and Grid definitions are validated without running code-behind. Unknown controls/properties, unsupported markup extensions, DTDs, malformed XML and invalid names fail with `SFXAML001`–`SFXAML008` diagnostics and UTF-16 source spans.

```js
const session = new XamlDesignSession(xaml, {uri: 'Views/MainPage.xaml'});
const design = new DesignDocument(session.document);
design.setProperty('Text', 'Updated', ['Caption']);
const plan = session.plan(design.value, xaml);
// Apply plan.edits only if the workspace version and plan.expectedText still match.
session.commit(plan);
```

Unchanged XML remains byte-identical. Scalar updates keep original attribute quotes, whitespace, comments, entity spelling outside the edited value, BOM and line endings. Structural edits canonicalize the visual root while retaining namespace/class metadata and all comments; code-behind is a separate file and is never rewritten. XAML and C# formats use an explicit provider registry and the same optimistic host transaction protocol. Studio's XAML editor writes through workspace operations, so existing history and disk conflict checks remain in effect.

The XML parser and edit application are reused through the public `@sharpforge/project-system` entry point. That package depends on archive/workspace and has no designer dependency, so this reuse introduces no package cycle or external runtime dependency. XAML parsing defaults to 1 MiB of text, 1,000 controls and 80 levels. The generated literal markup can also be projected to managed source/CIL scenes through `generateDesignCode`; that projection does not compile native partial classes. Resource/binding extensions require registered providers and native Windows behavior remains separately qualified.
