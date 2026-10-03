# C# ↔ Designer, common BCL and WinUI playback — 0.13.0

SharpForge remains an executable managed/browser profile. This release adds source ownership and C# writeback, commonly used closed collection and text APIs, and a shared timeline implementation. It does not imply arbitrary C# round-tripping, general generics or native Windows App SDK compatibility.

## Start with the linked-source example

1. Choose **Examples → Designer · C# two-way editing**.
2. Choose **Designer**, then **Connect C# → Program.cs**. The **Create** method maps to the visual tree and artboard. The existing source document opens below the design surface in **Split** mode; it is the same editor, not a replacement textarea.
3. Select **ApplyButton** in the tree or on the surface. Edit Content, Width, Left, or another literal property. With Auto sync enabled, the candidate C# is compiled and the smallest supported source edits are applied.
4. Edit the same property in C#. After a short debounce, the valid declaration updates the artboard. Incomplete syntax keeps the previous valid preview. Source undo/redo also updates the preview.
5. Build/run to execute the original managed OnAction handler. Input-preview mode does not execute arbitrary C# event handlers. Use the running WinUI Application tool to test managed behavior.

**Auto sync** can be disabled for explicit **Read C# / Apply to C#** operations. **Go to C#** navigates from the selected control to its original construction statement. **Design**, **Split**, **C#**, and **Preview** are editor views, not separate source buffers. Preview is an input/layout preview; it is not a hidden compilation/execution of hand-written code.

### Ownership and edit contracts

The reader uses the compiler's syntax tree and absolute UTF-16 spans. It does not execute source to discover the UI. Supported inputs are block-bodied Create, InitializeComponent or Main construction methods using known controls, locals or fields, object initializers, literal property assignments, child/content relationships, Canvas/Grid/wrap-grid attached properties, event method groups, styles, BasedOn and supported template factories. The first applicable method in the selected file is used; use a dedicated construction file for ambiguous multi-view files.

A scalar edit changes its recorded expression span. Comments, line endings, identifier spelling, unrelated class members and hand-written event bodies remain untouched. Insertion, deletion and reparenting can require rebuilding the proven declarative construction method. That operation retains existing control identifiers and preserves methods outside the construction region, but formatting within the rebuilt region is canonicalized. It is not a promise to preserve every byte of a structurally rebuilt body.

Dynamic expressions such as `Width = CalculateWidth()` are **code-owned**: the property editor is disabled, and the expression is never evaluated or overwritten. The previous valid preview value is retained when available. Independent supported literal properties remain editable. Custom statements, constructor arguments that cannot be regenerated, multiple event subscriptions and ambiguous references prevent destructive structural regeneration. Unknown behavior is not silently dropped.

Source text/version, design revision and link generation are checked before and again after candidate compilation. Candidate validation runs separately from the active compiler workspace and extension state. If source and design both change, automatic synchronization stops with a conflict. **Read C#** asks to discard staged design edits; otherwise keep them for manual reconciliation. There is no arbitrary-code merge algorithm. A syntax or compilation failure does not overwrite the editor or active program. Begin Edit and Continue or stop a read-only debug session before writing C#.

The existing `.sfdesign.json` workflow remains available. A source link is an editing relationship, not a second independent authoritative copy. Disconnect before replacing a design with another document or attaching a running application. ZIP/folder saving preserves the C# files and saved design documents; after reopen, reconnect the construction file explicitly. Source versions cannot meaningfully survive import into another workspace.

### Library use

```js
import { CSharpDesignSession, DesignDocument } from '@sharpforge/designer';

const session = new CSharpDesignSession(source, { uri: 'View.cs' });
const design = new DesignDocument(session.document);
design.setProperty('Width', 240, ['button']);
const plan = session.plan(design.value, source);
// Compile plan.text and verify the editor version before applying plan.edits.
// A library caller owns those host-level checks; Studio already performs them.
session.commit(plan);
```

The reusable synchronizer depends on `@sharpforge/syntax`, `text`, and `framework`. Its errors carry source-span information where available. Unsupported construction patterns are intentionally protected rather than represented as empty or invented controls.

## Designer and workbench refinement

The existing 43 docking tools and 23 packages remain; the toolbox has 52 insertable entries. There are now segmented view modes, compact consistent toolbars, artboard presets with an accurate Custom state, scaled rulers, ancestor breadcrumbs and selection counts. The property grid groups identity, size/spacing, placement, appearance, typography and interaction. It displays mixed selections, color swatches, inherited/default origins and code-owned explanations. Irrelevant attached placement properties are hidden unless authored or explicitly searched. The source editor, undo stack and configured keyboard profile are retained.

Toolbox categories are collapsible and searchable. Dark/light workbench themes are both styled without recoloring the application's authored preview. The command palette includes all tool windows and the designer. About, architecture and compatibility dialogs now describe the current implementation rather than claiming that already-implemented Portable PDBs, async stacks and managed updates are absent.

## Common C# and BCL additions

### Language

- Regular and verbatim interpolated strings: `$"..."`, `$@"..."` and `@$"..."`, escaped braces/quotes, expressions, constant alignment and selected numeric format specifiers. Expressions are evaluated once in source order. Raw strings and custom interpolated-string handlers are not implemented.
- Collection initializers for supported List/HashSet and Dictionary contracts, framework indexers with compound operations, and disposable/versioned collection foreach enumeration. Receiver/key evaluation occurs once; changing a collection during iteration produces a managed failure and cleanup. Foreach iteration variables are read-only.
- Type checking and diagnostics distinguish supported closed framework types from general user-defined generic types. This is not arbitrary `List<MyType>` or native CLR generic assembly interoperability.

### Closed collection surface

`List<T>`, `HashSet<T>`, `Queue<T>`, and `Stack<T>` support **int, double, bool, string and object**. `Dictionary<TKey,TValue>` supports **string or int keys** and those five value types. Object collections can hold supported managed object references; naming an arbitrary user type as the generic argument is not supported.

Lists include Count/Capacity, Add/AddRange from arrays, Insert, Remove/RemoveAt/RemoveRange, indexing, Contains/IndexOf, Sort/Reverse, Clear and ToArray. Sets include Add/Remove, Contains and array-based union/intersection/except operations. Queues and stacks include their normal push/pop/enqueue/dequeue/peek operations and snapshot ToArray. GetEnumerator returns a profile enumerator with version checking and Dispose. Dictionary includes indexing, Add/TryAdd, lookup/removal and snapshot Keys/Values arrays; it does not expose full KeyValuePair enumeration or `out`-based TryGetValue yet.

State lives in the managed heap and participates in collection and snapshots. APIs enforce size/capacity limits; a family operation is not an unrestricted host allocation. The list/queue/set implementations are not claimed to match native BCL internal complexity or performance. The exact available overloads are generated in the framework inventory.

### Text and numeric helpers

`StringBuilder` supports primitive append, AppendLine, AppendFormat (up to three values), insertion/removal/replacement, Length/Capacity/EnsureCapacity and whole/range ToString. Strings gain common null/whitespace checks, substring/search, trim, casing, replacement, splitting, padding, insertion/removal, concatenation, ordinal comparison and supported array Join/Format overloads. Additional Math functions include common trigonometry/logarithms and Clamp while retaining existing built-ins.

Formatting is deterministic **invariant**, not .NET current-culture behavior. Supported formats are a bounded subset of D/X/F/N/E/G/P; decimal/currency/custom/date-time format grammars and providers are not present. Fixed numeric rounding uses binary64 values and midpoint-to-even; it is not arbitrary decimal arithmetic. ToUpper/ToLower use the profile's invariant behavior. String searches and dictionary string keys use ordinal semantics. Unicode behavior is based on the JavaScript host and has not been exhaustively qualified against every .NET globalization table.

```csharp
using System.Collections.Generic;
using System.Text;
var values = new List<int>() { 3, 1, 2 };
values.Sort();
var text = new StringBuilder();
foreach (var value in values) text.Append($"{value:D2}");
Console.WriteLine(text.ToString()); // 010203
```

## WinUI timelines and transforms

The shared data-only clock backs both the managed bridge and the independent JavaScript facade. `Storyboard`, `DoubleAnimation`, `TimeSpan`, `Duration`, `RepeatBehavior`, `ClockState` and `FillBehavior` implement selected timeline behavior: From/To/By, BeginTime, SpeedRatio, repeat count/duration/forever, AutoReverse, Pause/Resume/Stop, Seek, SkipToFill and managed Completed handlers. Easing includes Quadratic, Cubic, Quartic, Quintic, Sine, Circle, Power and Back, with EaseIn/EaseOut/EaseInOut.

Target a supported scalar dependency property using SetTarget plus SetTargetProperty, or a unique live Name with SetTargetName. Selected attached paths and RenderTransform paths are supported. Translate, Scale, Rotate, Skew and Composite transforms render through the HTML host. A transformed drawing primitive falls back to DOM rather than being drawn by an untransformed GPU path.

The runtime worker advances active clocks after Main has returned and between queued UI callbacks. It pauses at debugger stops; resuming does not add paused wall time to the clock. Stopping/restarting the application cancels the old pump. Playback requires an active application window for automatic worker ticking. Headless code uses the explicit profile extension below.

An animated value temporarily overlays base properties. Local or style changes during playback update the stored base; Stop restores the latest base, not a stale value captured at Begin. Shared styles, local-value inspection, clearing and template updates retain their existing precedence. Clocks are snapshot data and retain referenced targets/timelines for GC. Managed completion callbacks run through the scheduler, not inside a renderer property setter.

```csharp
using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Animation;
var button = new Button() { Opacity = 0.4 };
var animation = new DoubleAnimation() {
    From = 0, To = 1,
    Duration = new Duration(TimeSpan.FromSeconds(1))
};
Storyboard.SetTarget(animation, button);
Storyboard.SetTargetProperty(animation, "Opacity");
var storyboard = new Storyboard();
storyboard.Children.Add(animation);
storyboard.Begin();
SharpForge.UI.AnimationClock.AdvanceBy(500); // explicit headless profile clock
Console.WriteLine(button.Opacity); // 0.5
storyboard.Stop();
Console.WriteLine(button.Opacity); // 0.4
```

For the JS facade, `createWinUIApp(element, {animationManual: true})` disables automatic RAF playback; `app.advanceAnimations(milliseconds)` advances the same clock deterministically. Studio exposes `setUIAnimationMode(true)` and `advanceUIAnimations(milliseconds)` for controlled testing. These are SharpForge extensions, not native Windows APIs.

Budgets: at most 128 registered storyboards, 512 nodes per timeline and depth 16, with validated numeric ranges. Completed clocks remain available for state/control queries until stopped or disposed. A forever storyboard cannot SkipToFill. Unsupported target paths, invalid definitions, duplicate/cyclic children and ambiguous names are rejected. This is not the entire native animation engine: keyframe/color/object animation, Composition, VisualStateManager and a visual timeline/keyframe editor remain unimplemented.

## Wrapping layouts

`WrapGrid`, `VariableSizedWrapGrid`, and `ItemsWrapGrid` accept ItemWidth/ItemHeight, orientation and maximum rows/columns. VariableSizedWrapGrid has independent RowSpan/ColumnSpan attached properties and measured browser coverage. Designer insertion, source generation and source reading retain those spans instead of confusing them with Grid placement.

These are bounded HTML/CSS layouts, not native measure/arrange parity or a virtualized ItemsRepeater implementation. Intrinsic measurement, item-source realization, scrolling ownership and all WinUI edge cases are not equivalent. No native WinRT DLL runs merely because a type name is recognized.

## Examples and tests

Eight new Studio and disk/ZIP examples: linked source/design authoring; storyboard controls; wrapping cards; animated style precedence; collection basics; dictionary inventory; StringBuilder/text; interpolation. See `examples/release13`. All compile and execute through source VM, canonical CIL reload, direct CIL and exported/reassembled IL in automated tests. UI callbacks and post-Main animations additionally run through real production workers in Chromium.

Use `npm test`, `npm run test:browser:sync`, `npm run test:standalone`, and `npm run test:packages`. On restricted runners set `SHARPFORGE_IN_MEMORY=1` and `CHROMIUM_EXECUTABLE` to an installed browser; the harness does not claim HTTP/file-origin or persistent-storage qualification. The actual native SDK gate is separate and reports unavailable when dotnet is absent.

## Reference contracts

The implementation was checked against Microsoft documentation for [interpolated strings](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/interpolated), [Storyboard](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.media.animation.storyboard?view=windows-app-sdk-1.8), [VariableSizedWrapGrid](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.controls.variablesizedwrapgrid?view=windows-app-sdk-1.8) and [standard numeric formats](https://learn.microsoft.com/en-us/dotnet/standard/base-types/standard-numeric-format-strings). Those sources describe Microsoft APIs; the limitations and selected overloads above describe this implementation, not a claim of complete equivalence.
