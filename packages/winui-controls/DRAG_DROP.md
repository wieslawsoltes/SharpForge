# Drag and drop

A16-T04.8 uses one application-owned `DragDropManager`. It resolves the physical hit to the nearest enabled `AllowDrop` ancestor and sends `DragStarting`, `DragEnter`, `DragOver`, `DragLeave`, `Drop`, and `DropCompleted` through the same routed-event engine as pointer input. `AcceptedOperation`, `AllowedOperations`, and `DropResult` use `DataPackageOperation` flags (None 0, Copy 1, Move 2, Link 4). Modifier preferences are intersected with source permissions. `GetPosition` uses the target's inverse world transform.

## Data and native browser boundaries

The event wire contains a bounded DataPackage snapshot, never `DataTransfer`, `File`, a DOM element, or callback. Text, HTML and HTTP(S) URI formats share the application's DataPackage model. HTML remains data; this path does not insert it into the DOM. The drag transport permits 64 KiB of UTF-16 data. The general clipboard/data package service can have a larger budget.

`DragServices.completeEvent(eventName, payload)` runs once after the entire managed route, including ordinary handlers and AddHandler registrations. It sends a `dragResponse` command to the host. An internal drag reads that updated private source payload at its destination, including text prepared by an asynchronous worker or drag deferral. DragOver replies update the cached acceptance used by the next native drag event. The command includes the session and target identity; expired sessions and superseded targets cannot receive a stale response.

An outgoing browser drag can write the operating system's native data store only during the browser's synchronous `dragstart` callback. An application that needs drag data to reach another application must prepare its source with `services.drag.prepare(owner, dataPackage, options)` before that callback. A worker reply can cancel the logical internal operation, but cannot revoke an operating system drag already in progress. This is a browser capability boundary, not simulated native behavior.

Drag deferrals delay the managed reply until all deferrals complete. They do not stop the browser's synchronous event loop. Caption, glyph visibility and bitmap feedback use a host-owned DOM layer. Bitmap feedback requires `services.dragBitmapElement(id)` to resolve an existing decoded image; unsupported software-bitmap APIs are not declared as successful no-ops.

## External files

A file drop creates a per-host expiring opaque token. The event carries only that token, an item count, and the `StorageItems` format. The token is not a file path. File objects remain inside `DropFileBroker`, never a scene snapshot or worker packet.

`GetStorageItemsAsync` consumes the token through `services.drag.storageItems`. The browser broker first calls `dataTransferPolicy.policy.authorize('storage-items-drop', {count, bytes}, {signal})`. Only a true result permits `dataTransferPolicy.readFiles(files, {signal})` to run. The adapter returns bounded plain descriptors `{id, name, contentType, size, lastModified}`. The managed projection is a read-only `IReadOnlyList<IStorageItem>` containing `StorageFile` objects; Path is empty because browsers do not disclose native filesystem paths. Reading file contents requires a separate explicitly registered storage capability.

Tokens expire after 60 seconds by default, are bound to one host, and are released after a read or failure. There are limits on file count, bytes, and outstanding drops. Session disposal aborts pending permission/adapter requests. Constructing a control or merely dragging a file over it never requests permission.

## Integration

- Register `registerLayoutContracts` and `registerLayoutAdapters`; both include the drag contributors.
- Create `createManagedDragServices(context)` in the VM and `new DragServices(context, {send: c => host.apply(c), readFiles: ...})` for JavaScript.
- Resolve `dragArgumentTypes[eventName]` before a legacy generic delegate in the typed event bridge.
- Call `services.drag.completeEvent(eventName, payload)` once after synchronous route dispatch. Mutable drag setters update the shared payload directly.
- The Studio request `dropFiles` accepts `{token}` only and calls `host.input.dragDrop.files.read(token, {signal})`.
- Source packets are `{op:'dragData', id, data, allowedOperations, cancel}`; response packets are `{op:'dragResponse', id, session, event, data?, allowedOperations?, cancel?, acceptedOperation?, dragUI?}`.

## Evidence and limits

`tests/a16-input-drag.test.js` covers text delivery, ancestor targets, operation flags, worker replies, clone safety, permission denial, host isolation, expiry, malformed inputs, and deferral completion. The browser gallery adds native DataTransfer and DOM event coverage. These tests are authored for the consolidated epic validation batch; no result is claimed until that batch runs.

The public shape follows Microsoft's [DragEventArgs](https://learn.microsoft.com/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.drageventargs), [DragStartingEventArgs](https://learn.microsoft.com/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.dragstartingeventargs), [DragUIOverride](https://learn.microsoft.com/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.draguioverride), and [DataPackageOperation](https://learn.microsoft.com/uwp/api/windows.applicationmodel.datatransfer.datapackageoperation) contracts. Tests here establish the browser/managed profile; they do not claim an operating system drag manager or unrestricted native StorageFile access.
