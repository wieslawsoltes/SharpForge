# Prepared workspace ingress and navigation

ZIP ingress uses the public Blob reader with the archive package's existing byte,
entry, ratio and path budgets. The current `WorkspaceLoads` ticket supplies its
abort signal and is checked during streaming and immediately before adoption.
No whole-file ZIP buffer is requested by the Studio host.

`StudioNavigation` optionally accepts `prepareDocument(uri, {signal})`. It
registers one owner with `WorkbenchNavigation`; toolbar, direct window shortcuts
and menu history entries all use the same history and bounded replay queue from
`createWorkspaceNavigation`. The callback must return an admitted record, or
`null` when a target is unavailable. Errors reject the operation without advancing
the history. Clear/disposal abort pending preparation and document admission. A
foreground history change during either asynchronous phase invalidates the replay.

Preparation and queued document reads happen before replay suppression so ordinary
foreground navigation can still record its location. `DocumentTabs.createOpenAdmission`
captures one request token from an optional signal and `isCurrent` predicate;
`open(uri, {admission, activate: false})` and the token's `activate` method retain
that same token through the promise handoff and final focus. Guarded requests
recheck ownership before and after document reads. A monotonically changing tab
generation invalidates older requests after any later tab request or foreground
activation, including activation away and back. A cancelled request returns
`null` without further activation or focus. If cancellation arrives after the
background panel was admitted, the tab service retains that panel; the document
service keeps ownership of any source record it has already loaded.

After admission the existing docking replay retains
group, view, selection, scroll and popout identity. Hosts without the optional
preparation callback retain their current navigation behavior.
The docking service continues returning a panel identifier after replay; the
standalone workspace controller continues returning its location record.
Full-location hosts receive the signal and an `isCurrent` guard, and own replay
suppression around synchronous activation. Each docking replay releases only its
own token, so cancelled work cannot clear a newer operation's suppression.

Focused coverage is in `a24-studio-streaming-ingress.test.js` and
`a24-studio-prepared-navigation.test.js`; existing workspace and docking navigation
fixtures cover the unchanged default contracts. Browser qualification remains
separate from these Node component assertions.
