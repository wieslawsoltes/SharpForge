# Physical directory identity and recent folders

`RecentWorkspaceHandles` uses IndexedDB structured clones to preserve comparable
File System Access directory handles. `identify(handle, {locks, signal})` compares
`isSameEntry` under one shared registration Web Lock. Equal display names never
establish identity. Existing version-one keys migrate when their handles are matched.

The version-two database separates the bounded recent menu (`workspaces`, default
20 entries) from persistent physical keys (`identities`, default 100,000 entries).
Recent eviction and `forget(identity)` remove menu entries only. Physical keys are
never rotated or evicted: reaching registry capacity reports `SFW1326` and leaves
all existing folders reusable. A duplicate or invalid generated key reports `SFW1327`.
Applications must not clear this registry while another window may still own its keys.

`remember`, `list` and `forget` manage recent-folder metadata. Authority, credentials,
trust and permission fields are stripped from saved open-document settings. `reopen`
must run from a user action: it rechecks/request permissions, returns a read-only
recovery result on denial, and never restores a prior permission grant.

`identify` rechecks cancellation and disposal after every asynchronous comparison
before returning or publishing a key. `dispose` closes the database and rejects
pending registration; a database that finishes opening after disposal is closed.
The Node regression suite uses an explicit IndexedDB request/transaction fake and
Web Locks adapter. Native browser picker/permission prompts and other browsers need
separate qualification; these tests do not claim those platforms passed.
