# Test Explorer controller and view

`TestExplorerController(host, adapters)` owns provider selection, discovery,
selected tests, streamed results, diagnostics and retained artifacts. Its host
supplies `contexts.request()`, the optional `getTestInput({signal})` project input,
`getTestProject()`, rendering and source-navigation callbacks. Native operations
also use the host's trust-aware `operation(label, action)` and authenticated client.
The adapters are injected per instance and disposed with the controller.

Discovery snapshots source versions, text, project revision and evaluated context.
A later run rejects stale discovery or an empty selection. VSTest selects all rows
of a method together because its supported filter identifies methods. Portable
source and CIL providers execute the same selected test model through the worker.
Cancellation retains terminal results and labels unfinished tests as not run.

`renderTestExplorer(controller, element)` renders the labeled provider controls,
selection, name/class/trait filtering, durations, failure details and source action.
Native providers expose coverage, build reuse and debugger handoff controls. The
view renders at most 250 test rows, 500 artifacts, 250 coverage files and 300 lines
per expanded coverage file. The complete report remains downloadable. Output and
source text are escaped; native debugger attachment is an explicit host handoff.

The full native build controller and application docking registration are separate
consumers. This batch provides the complete injected controller/view contract and
does not modify the protected Studio entry.

## Qualification

Existing selection, invalid-provider, timeout, source-version, project-revision,
VSTest method-group, failure-location and full native controller cases passed in
the completed 106-test Node 22 and Node 26 native UI scopes. The direct host-contract
file in this projection retains those behaviors without needing the native build
controller dependency; it is queued for root's final bounded qualification.
Native installed-framework and coverage collector qualification remain open.
