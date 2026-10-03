# SharpForge 0.13.0

Built from the verified 0.12.0 source. This release contains genuine C# ↔ designer editing, additional common C#/BCL contracts, timeline playback and workbench refinement. It remains a managed/browser development preview.

## Source synchronization

New reusable CSharpDesignSession/readDesignSource/planDesignSourceUpdate APIs read syntax and preserve source spans without executing UI code. Studio links the original source editor, validates candidate C#, uses source/design version checks, applies minimal property edits, and regenerates only proven structural regions. Unknown/custom code and dynamic expressions are protected. Event handlers outside the construction method survive; conflicts and incomplete edits retain the previous preview. Source undo/redo and Go to C# are connected.

## UI

Design/Split/C#/Preview modes, device presets, rulers, breadcrumbs, compact toolbars, grouped property editors, color swatches, mixed values, contextual placement fields, code-owned explanations and collapsible toolbox groups. Dark and light themes are both styled. Every tool appears in command search; architecture and compatibility dialogs are current. Visual Studio remains the default editor profile. There are 43 independent docking tools, 23 packages and 52 toolbox entries.

## C# and BCL

Regular/verbatim interpolated strings with expressions, alignment and selected invariant formats; closed collection types and initializers; typed framework indexers; disposable/versioned foreach. Lists, dictionaries, sets, queues and stacks use bounded managed state. StringBuilder and common string/Math operations are added. Supported element types and missing general generic/culture/LINQ semantics are explicit in the guide and generated API inventory.

## WinUI

Shared deterministic Storyboard/DoubleAnimation clocks, TimeSpan/Duration/RepeatBehavior, eight easing types, pause/resume/seek/stop/fill, scalar and selected attached/transform targets, and real managed Completed callbacks. Clocks run after Main returns, pause in the debugger and preserve animated/base/style precedence. Independent JS facade uses the same implementation. Added three wrapping panels and five transforms with safe DOM fallback for transformed drawing content.

## Examples and distribution

Eight new Studio/disk/ZIP examples; 60 Studio examples total (59 runnable and one intentional diagnostics case). Source includes prebuilt browser files, standalone HTML, all 23 offline-installable tarballs, guides and tests. No repository or registry publication was requested or performed.

## Boundaries

Source sync is conservative and not a decompiler for arbitrary C#/XAML construction. Closed BCL types are not general native CLR generics. Formatting is invariant and incomplete. Animation is not full Composition/keyframe/VisualStateManager support. Wrapping panels use CSS layout and are not virtualized native WinUI panels. Physical GPU, native SDK/CLR, external IDEs, normal HTTP/file-origin navigation and durable storage have separate qualification boundaries. See validation and the feature guide.
