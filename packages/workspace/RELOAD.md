# External document reload

`DocumentReloadCoordinator` consumes provider create/change/delete/rename events.
The host supplies `getDocument(path)`, `replaceDocument(path, record, options)`
and optional `removeDocument`, `applyChange`, `onPrompt`, `onKeep`, `onReevaluate`
and `onError` callbacks. Documents expose text, a monotonic version and dirty state.
An atomic host can supply `applyChange({path, disk, event, expectedVersion})`.
Its result is forwarded as `application` to `onReevaluate`, so a host that already
reevaluated its accepted XML snapshot can acknowledge that work without doing it twice.

Clean buffers accept decoded exact disk bytes. Dirty or concurrently edited buffers
retain their contents and prompt with `reload`, `keep` and `compare` choices.
Reload rereads the external hash and checks the current editor version. Another
external edit produces `Conflict`; a new explicit choice is required. Pending prompts
are bounded by `maxPending` (default 1024), with `QuotaExceeded` on admission failure.
Binary transitions require an explicit atomic host adapter; text-only adapters reject them.
`dispose()` aborts pending reads and removes prompt metadata. This module does not own
an editor or render a prompt; those callbacks compose into the separately published Studio host.
