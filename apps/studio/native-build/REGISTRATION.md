# Native tools and Test Explorer registration

The tool registry contains one stable `tests` identity titled Test Explorer.
Build-oriented layouts place it beside evaluation, problems and output. The
Studio docking subclass reuses the workbench's document/disposal ownership and
opens the test panel in the existing bottom group when activated or reset to the
build preset. Existing tool identities and ordinary presets are preserved.

`contributeMsbuildAutomation(automation, {nativeBuild})` keeps the established
`native.connect/attach/run/cancel/open/save/configure/getState` methods. Nested
`contexts`, `profiles` and `testing` operations delegate to the same controllers
used by the visible views. They do not execute a second hidden workflow or bypass
native project trust and cancellation.

The original three registration/automation/facade assertions are preserved over
the actual published controller and renderer. They passed in the completed
106-test Node 22 and Node 26 native UI scopes. Core tool rendering and the protected
Studio constructor/callback integration belong to their separate owner batches.

## Native operation ownership

The updated controller dependency composes the workbench's captured native job
ownership, cancellation and disposal. Automation continues to call that same
controller, so an operation keeps its original owner while tool selection or
workspace state changes. This forward merge preserves the four registration
modules and their three original assertions byte for byte. The completed source
qualification remains recorded above; the root integration run covers the final
pinned-main composition without repeating a separate local matrix.
