# SharpForge 0.12.0 — rebuilt designer and Edit and Continue

Reconstructed from the verified 0.11.0 source; the previously claimed 0.12 archives were not recovered. This release contains newly built, tested source and actual browser/standalone/package artifacts.

Seven connected dockable designer tools bring the workbench to 43 tools. The searchable 48-control toolbox, editable visual tree, surface, typed/multi-selection property grid, layout editor, shared-style/template editor and generated-source view edit a validated saved document. Canvas drag/resize/snapping/nudging and Grid cell/boundary editing are undoable. Ctrl-wheel zoom, pan, marquee selection, grouping, copy/paste, Grid tracks and JSON/ZIP persistence are integrated.

A new independently packaged @sharpforge/designer library supplies transactional editing, design validation, scene capture/projection, C# project generation and minimal live patches. Live patches execute against source or direct-CIL managed objects with revision, identity and rollback checks. Untouched text, counters and handlers are retained.

Source Edit and Continue adds/reorders methods and types, appends instance fields, preserves static identities, maps compatible active locals, protects live delegates and rejects invalid active statements/exception regions/signatures. Direct-CIL structural updates remain restricted to compatible method-body updates. Candidate compilation never silently replaces the active program. Successful updates rebind breakpoints and clear reverse history; failures preserve it.

Framework changes add 16 controls, registered dependency properties, shared Style/BasedOn/Setter semantics and independent control-template instances. Managed and independent JavaScript APIs enforce local/template/style/default precedence, UnsetValue identity, typed values, input forwarding and rollback. The actual closed registry contains 101 named types and 795 ABI members, not 101 complete native controls.

Five new Studio examples and five complete disk/ZIP projects cover Canvas counter, Grid workspace, shared styles, input/control gallery and structural Edit and Continue. Studio now has 52 examples (51 runnable and one deliberate diagnostics case). All 23 reusable packages install and execute offline.

See [guide](edit-continue-designer.md), [validation](validation-0.12.0.md) and [generated API inventory](winui-api.md). This remains an explicit managed/browser development profile, not unrestricted native CLR/Visual Studio/Windows App SDK compatibility. Native Hot Reload, XAML, arbitrary bindings/resources/animations, custom dependency-property registration and physical-GPU qualification are not asserted.
