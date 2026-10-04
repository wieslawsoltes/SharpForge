# A05 control native qualification

These commands compile a fixture once with the installed .NET SDK and execute the same DLL in native .NET and the CIL interpreter.
They write source/assembly hashes, SDK/runtime versions, commands, stdout, exit code, and VM outcome to their evidence directories.
They require a real SDK/runtime; authored fixtures and JavaScript tests do not establish native parity by themselves.

| Requirement | Native command | Independent coverage |
| --- | --- | --- |
| #1355 interface implicit/explicit/default/most-specific selection | `node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05/default-interfaces --output artifacts/a05-interfaces` | `a05-02-interface-dispatch` checks ambiguous and malformed metadata; `a05-source-interface-dispatch` checks all three routes. |
| #1362 variable arguments and typed references | `node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05-source-varargs --output artifacts/a05-varargs` | `a05-02-varargs`, `a05-02-source-varargs`, `a05-source-varargs-snapshot`; unsupported unmanaged vararg P/Invoke remains an explicit named-member failure. |
| #1371, #1374–1378 filter ordering, nested cleanup, hierarchy, typed catches, exception objects | `node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05-control-exceptions --output artifacts/a05-control-exceptions` | The native fixture observes pre-finally state in an outer filter, treats a throwing filter as false, exercises three cleanup levels and replacement exceptions, and checks preserved/reset/EDI traces by method presence. |
| #725 Roslyn async state machine and iterator | `node scripts/validate-a05-type-system.js --async --fixture tests/fixtures/a05-async --output artifacts/a05-async` | Captures the first two distinct awaits of one machine, checks local and fresh-VM portable replay, and includes full/early iterator disposal. See `a05-async-qualification.md`. |

C# cannot directly spell a CLI `fault` clause or an unresolved runtime DIM diamond. Those cases retain independent emitted-CLI fixtures;
the source diamond is rejected with CS8705 and the metadata diamond raises the managed ambiguity exception on invocation.
Native stack traces contain runtime-specific formatting, so the exception fixture checks relevant method presence instead of comparing whole strings.
NoInlining attributes keep the native trace checks stable under Release JIT optimization.

#726 synchronization and #1379 AppDomain event native fixtures are maintained by the synchronization/event workstream. Their native
qualification must avoid asserting thread scheduling order. Unhandled termination requires an abnormal native outcome and a faulted VM,
with stdout event ordering compared separately from platform-specific process signal codes.

The vararg run must record a runtime/platform refusal honestly if that .NET host does not implement managed varargs. An unsupported native
execution is not equivalent to a VM conformance pass. Source and direct-CIL variable-argument tests remain deterministic and independent.
