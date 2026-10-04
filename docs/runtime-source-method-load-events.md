# Source VM method-load events

An observed source or reloaded-source VM now emits the existing `MethodLoad`
event immediately before the first `MethodEnter` for each source metadata method
object. This is lazy execution admission, not a report of every declaration in an
image: unused methods emit nothing, and failed frame admission emits neither event.
The entry method's pair is recorded during construction, before instruction zero
has executed. Subscribers remain deferred to the established host boundaries.

The payload follows the CIL shape `{method, name}`. Here `method` is the existing
numeric source method ID, and `name` is its qualified display name, limited to 4096
characters using the same bound as CIL. The event contains no body, signature,
managed handle or frame object. No new event name or public API is introduced.

The source observer uses a weak identity set of metadata method objects. Repeated
calls and successful same-VM snapshot replay do not emit duplicate loads for the
same object. Log history and subscriber cursors remain chronological; explicit
subscriber replay delivers retained records without creating new events. Ring
overflow can drop a load record without making the method appear newly loaded.
The weak set does not retain replaced metadata or its code body.

If a host replaces a metadata method object, the replacement's first successful
admission emits a new load even when its numeric ID is unchanged. This identifies
an observed metadata replacement, not an implicit code-versioning protocol;
in-place edits to the same method object do not synthesize load events. Existing
verification and code-invalidation requirements still apply to edited programs.

This small #1403 leaf extends [source method lifecycle events](runtime-source-method-events.md)
without VM, heap, frame or snapshot fields. `tests/a05-source-method-load-events.test.js`
authors source/reload coverage for first admission, repeated calls, unused and
rejected methods, snapshot/subscriber replay, metadata replacement, name bounds,
disabled observation and ring overflow. Tests are pending root's serial validation;
no performance or platform qualification is claimed here.
