# Incremental workspace search

`WorkspaceSearchIndex` indexes normalized path metadata without reading closed files.
`addFiles` cooperatively admits records; `upsert`, `remove`, `invalidate` and
`onWatchEvent` apply incremental changes. Defaults bound the index to 100,000 entries
and 32 MiB of estimated path/posting storage. Path result iteration is cancellable;
`findPaths` streams scored matches and `searchPaths` returns a bounded sorted list.

`findText` streams literal content matches with one-based line/column values.
`findInFiles` returns the LanguageService shape: `{matches, truncated, scannedFiles}`,
where each match has URI, UTF-16 start/end, document version, zero-based line/character
and preview. Case sensitivity and Unicode whole-word boundaries are explicit options.
The default content LRU is 16 MiB and individual reads are limited to 8 MiB.
Binary/oversized files are skipped; inaccessible or changed files report diagnostics.
No closed editor is opened to search text. Dirty editor overlay composition belongs to the host.

Concurrent reads use entry identity/generation checks before populating the content
cache. Invalidation, deletion or same-path replacement cannot refill it with stale bytes;
overlapping current reads count cached bytes once. `watch` owns one provider subscription,
and `dispose` releases subscriptions and index/content storage. This package service
does not add Studio controls; the dependent Explorer controller supplies those.

Pending watch metadata probes share the entry-count bound. Replacement, deletion
and disposal invalidate each path's pending status token before it can publish.
Overlapping watch setup keeps only the latest subscription; aborted or superseded
subscriptions are disposed as soon as setup returns. Disposal zeroes byte counters.

Content streams capture each entry identity, invalidation generation and version before
reading text, then recheck that identity before every result. A replacement or deletion
emits SFSEARCH001 and stops that file. Each `findText` match includes the captured
`version`; the LanguageService adapter retains it across asynchronous handoff.
Default searches snapshot the bounded indexed path list once so a replaced path cannot
be revisited and newly inserted paths wait for the next search. Content remains streamed.
