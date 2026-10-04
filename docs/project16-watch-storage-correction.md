# Watch storage registration after hosted a4

Hosted run 37175293552 at `8d1be9cffa04b0fd7390e5cb6fe5f6c03b997557`
failed the actual Studio 200 MiB input case with
`Unregistered storage key sharpforge.watch-windows.v1`.

Studio installs Watch windows with the production `createStorage` adapter before
opening files. The Watch state reader used its v1 key, but that key was absent
from the adapter's exact allowlist. Its constructor reported the rejected read
through Studio's error toast. The large-file driver subsequently encountered
that existing toast during import. This evidence does not establish that the
200 MiB source reader itself rejected the file.

The correction registers the existing identifier as `storageKeys.watchWindows`
and uses that canonical entry in `WatchWindowState`. It preserves the v1 payload,
the exact storage allowlist, explicit persistence errors, and atomic failed
writes. The focused regression composes production storage, Watch installation,
commands, source-file import, workspace loading and document services; earlier
Watch tests used a raw Map backend and bypassed storage registration.

`tests/a19-watch-storage-host.test.js` adds four cases for startup plus import,
v1 restoration, malformed/unknown keys, and quota failures. They are authored
but not executed at this source cutoff. The existing actual 200 MiB browser
driver and its assertions are unchanged. No corrected hosted, browser or
performance pass is claimed; the original a4 failure remains historical evidence.
