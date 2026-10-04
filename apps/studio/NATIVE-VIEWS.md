# Native view host contracts

The native build, project-context, source and inspector views consume explicit host objects. They do not connect a transport or start an SDK operation while rendering. Their controller supplies the model state, mounted element map and action callbacks.

| Export | Required host state and callbacks |
| --- | --- |
| `renderNativeBuild(host, force)` | `hosts.get('msbuild')`, settings, workspace, capabilities, busy/job/log state; `run`, `cancel`, `refresh`/`connect`, `attach`, `save`, `open`, `artifact` |
| `nativeContextMarkup(host)` | Context and profile model snapshots; an active context has a matching compilation with source and reference arrays |
| `bindNativeContextView(host, element)` | Context selection/load, profile read/selection, `runProject`, `publishProfile`, optional `onSelectPanel('tests')` |
| `updateNativeContextControls(host, element)` | Workspace presence, busy state, SDK availability, context list and selected publish profile |
| `renderNativeSource(host, force)` | `hosts.get('project-source')`, workspace files, source path and mutable buffer map; `open`, `save`, `renderSource`, `inspectSolution` |
| `renderNativeTree(host, element, query)` | Workspace files and `open(path)` |
| `renderNativeInspector(host)` | `hosts.get('msbuild-inspector')` and the current inspection result |

Absent mounted panels are ignored. Rebuild markup with `force` after model changes that alter selectors or options. Output and invocation text use `textContent`; HTML values are escaped through the editor package. Views show at most 100 context diagnostics, 500 tree rows, and 500 items per inspector item type. Filtering is case-insensitive and does not modify the workspace or inspection result.

Profile discovery and selection are inspection actions. Native run and publish have separate buttons. Busy or unavailable-SDK states disable execution controls; connected profile inspection can remain available without an SDK. Callbacks retain responsibility for trust, validation, cancellation and transaction boundaries. Non-cancellation callback failures reach `onError`; `AbortError` is treated as a cancelled action. The source editor updates its existing buffer and preserves its disk baseline; save remains explicit, including Control/Command-S.

`tests/a23-native-view-contracts.test.js` exercises these exported view functions through a small element port. It checks escaped output, action routing, availability states, bounded lists, filtering, unchanged data, buffer identity and keyboard-save dispatch. The port does not parse HTML or emulate layout. Browser focus/layout, the composed controller, protected Studio entry wiring and native Windows execution retain their separate qualification records.
