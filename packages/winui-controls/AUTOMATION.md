# Automation and accessibility

The retained host has one automation tree per application root. Its peer definitions feed programmatic pattern calls, native DOM semantics, and GPU semantic proxies. Layout bounds and clipping come from the same affine geometry used for drawing and hit testing. An element that scrolls out of view remains represented in the accessibility tree; collapsed content is hidden. Native text editors retain their browser input, selection, and accessibility behavior.

## Registration and language integration

Register `registerAutomationContracts(registry)` in the A16 contract reservation. `registerAutomationAdapters(rendererRegistry)` adds renderer peer factories. The separate `registerAutomationMemberAdapters(uiExtensionRegistry)` implements the declared managed/JavaScript peer and provider members; it does not add a dispatcher fallback.

JavaScript installs `createAutomationMemberServices(context, {tree: host.automation})`. Managed execution installs `createManagedAutomationServices(context)` after the shared managed layout service. The latter uses the existing managed control models through `getControlFamilyModel`; it does not manufacture a DOM or estimated text metrics.

The framework base-constructor bridge calls `services.automation.initializePeer(receiver, ownerType, args)` for automation peer base types. That method initializes the original derived receiver. Application `OnCreateAutomationPeer` and protected `*Core` overrides run through the language's actual virtual dispatch. A protected base call executes base behavior on that same peer. `FromElement` and `CreatePeerForElement` preserve the published peer identity with an owner-scoped managed heap edge. Explicitly returning `null` from `OnCreateAutomationPeer` suppresses the peer.

The public factory preserves the absence of default native peers on general layout containers. The browser still uses internal generic semantic nodes to retain accessible descendants. Internal semantic nodes are not an assertion that a native WinUI public factory returns a peer for every element.

## Patterns and state

Implemented provider families are Invoke, Toggle, Value, RangeValue, Selection, SelectionItem, ExpandCollapse, Scroll, ScrollItem, and a bounded Text subset. Actions use the same command, selection, range, and editor models as ordinary control interactions. Browser-only operations such as realizing a distant item require the injected host service. Unsupported operations throw a named capability error.

List selection returns peers for logical item occurrences, including primitive items and duplicate values. The occurrence key remains stable while the shared selection model reconciles insertions and moves. Actual realized rows supply geometry; unrealized rows report offscreen with empty bounds. Peer creation is bounded and never realizes the entire items source. Container recycling does not change logical peer identity.

Text ranges use UTF-16 offsets. Character/word navigation uses `Intl.Segmenter`; geometry, visual lines, inline mapping, and range scrolling require the real text-layout service. These capabilities are not inferred from character counts. Password peers provide neither Value nor Text and cannot publish textual automation notifications.

Automation events use a bounded per-root queue. Repeated property changes coalesce while preserving the first old value and latest new value. Live-region announcements are added once to polite or assertive regions without moving focus. Automation-owned attributes are tracked separately from renderer-provided native labels; an ordinary element `Name` does not replace a child label. Explicit `AutomationProperties.Name` and `LabeledBy` control accessible naming.

## Evidence and platform boundaries

The API profile is pinned to the Windows App SDK 1.8 documentation:

- [AutomationPeer](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.automation.peers.automationpeer?view=windows-app-sdk-1.8)
- [CreatePeerForElement identity and default-peer behavior](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.automation.peers.frameworkelementautomationpeer.createpeerforelement?view=windows-app-sdk-1.8)
- [IsKeyboardFocusableCore](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.automation.peers.automationpeer.iskeyboardfocusablecore?view=windows-app-sdk-1.8)

The source, serialized-image, and direct CIL fixtures are in `tests/a16-automation-managed.test.js`. Model, malformed-input, disposal, and range fixtures use the `a16-automation*` prefix. Browser gallery evidence must use actual DOM accessibility snapshots and keyboard interaction, with separate runs for DOM, Canvas2D, and available WebGPU. Structural checks in `auditAutomationSnapshot` and `auditAriaDom` identify their own engine; they are not reported as axe-core, a screen reader, or native Windows qualification.

Browser bounds are application-root logical pixels. This profile does not register a Windows UIA COM provider or claim physical desktop coordinate parity. Native SDK metadata comparison and native assistive-technology sessions remain separate evidence requirements. Unsupported browser platform controls keep their explicit capability errors.

Validation is deliberately deferred until the full assigned epic scope and integration dependencies are present, as requested for this Project14 implementation batch.

## Worker transport

After browser layout feedback, the worker calls `services.automation.publishTree()`. It publishes changed application-defined peers as `{op:'automationPeer', id, state}` commands. Flat core values, advertised patterns, and child identities are validated before the host applies them. The host layers these values onto its existing peers, preserving peer identity and keeping private managed objects out of the scene.

The browser supplies `onAutomationAction(id, method, args, pattern)` to dispatch custom pattern actions back through one bounded worker action. The worker calls `services.automation.tree.invoke(id, method, args, pattern)`; that method accepts only the explicit automation operation table. Explicit peer events and notifications use `{op:'automationEvent', id, event}` and enter the host's bounded live-region queue. Custom Text providers that require synchronous application callbacks across workers need an explicit host text adapter; the built-in Text subset continues to use the real browser text service.
