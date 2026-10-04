# A05 source interface dispatch

Work item: SF-A05-T02.2 / Project 7 issue #1355.

Source interface calls retain their declaration with `CALLVIRT` (appended opcode 58), whose operands are the image method ID and
argument count including the receiver. A call consumes its arguments and produces one result, including the existing null placeholder
for void methods. A null receiver faults before a method body executes.

Interface types preserve inherited interface names. Methods preserve virtual, abstract, final, new-slot, accessibility, and explicit
implementation identities. The CLI emitter writes real InterfaceImpl and MethodImpl rows; abstract methods have RVA zero and no body.
The source loader derives those identities from CLI metadata and continues to require exact canonical re-emission.

The source runtime presents its monomorphized declarations to the existing `CilDispatchTable`. Implicit and explicit implementations,
class precedence over default bodies, most-specific default selection, and ambiguous diamonds therefore use the same algorithm in the
source and direct CIL engines. Invoking a boxed struct implementation uses its owned box interior, so mutations persist in the box.
Dispatch caches contain declaration metadata and no guest roots; calls retain ordinary frame admission, exception, and snapshot behavior.

Generic interface methods are materialized only for reachable closed method arguments. The compiler indexes the binder's existing
declaration-to-implementation map by exact closed interface identity. Both a newly reached method construction and a later constructed
receiver type replay that index, so a method first reached through the interface still brings its implementing body into the image.
Closed receiver and method arguments remain separate. The resulting ordinary method IDs retain exact MethodImpl rows and continue
through the same CLI dispatch table. A bounded materialization budget prevents unbounded interface construction work.

Focused qualification:

```sh
node scripts/limited.js node --test tests/a05-source-interface-dispatch.test.js tests/a05-source-generic-interface-methods.test.js
```

The source fixture checks source, canonical reload, and direct CIL routes. Valid source rejects an unresolved default diamond with CS8705;
the metadata fixture removes a class implementation to prove that ambiguous runtime metadata faults only at the invoked declaration.
The existing CIL interface fixture retains its unsafe competing-body admission and explicit signature rejection cases.
Generic qualification also covers implicit/explicit targets, most-specific generic defaults, independent receiver/method arguments,
late receiver construction, invalid arity/signatures, and rejection of an incompatible receiver before a target body executes.
