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

Limits: 1,000 design controls, 100 levels, 64 tracks per axis, 500 parts per template, 100 undo entries. The design document—not arbitrary C# or XAML—is the authoring source. This package does not implement native WinUI, XAML, unrestricted dependency-property registration, native CLR updates or a general C# round-trip designer. See the application's Edit and Continue / Designer guide for the supported profile.

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

This is not a general C# decompiler or bidirectional XAML engine. Source edits to handlers outside the construction region remain user-owned.
