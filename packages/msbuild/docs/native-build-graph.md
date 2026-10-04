# Native build graph and explicit up-to-date checks

`NativeBuildService(engine).build(request, {signal})` authorizes the request and
resolves any saved `request.solution` mapping before computing a context key or
scheduling native work. A project selected from a solution therefore receives its
mapped configuration/platform and properties. Original solution selection fields
remain available so repeated mapping is idempotent.

The default behavior delegates to native MSBuild. `fastUpToDate: true` opts into a
check over explicitly complete `inputs` and `outputs` arrays of canonical files
inside the granted workspace. It records a baseline only after a successful
build. Hashes, modification times, item membership and global properties must all
match before a build is skipped. Missing or changed files, a new baseline or
changed properties produce an explanation and run native work. Projects with
side-effecting targets should leave this optional optimization disabled.

The Node entry exports `FastUpToDateCheck` for declared input/output fingerprints,
`ProjectBuildGraph` for context-keyed dependency traversal, and
`NativeProjectGraphService` for authoritative context discovery and scheduling.
Graph identities include the project configuration, platform, framework and RID;
project references use the public project-system compatibility/context selector.
Cycles report `MSB4251`; absent or duplicate dependency identities fail explicitly.

`MSBuildClient.buildGraph(request, {signal})` returns `{nodes, order}` from the
registered `build/graph` service. `buildAffected({...request, changedPaths},
{signal})` builds owning contexts and transitive dependents in dependency order,
leaving unrelated contexts alone. Each scheduled native build disables recursive
project-reference building because the graph already supplies the order.
Cancellation reaches the current process, and a failed dependency stops the run.

Graph structure is cached for at most 16 requests by default, with a 512-project
discovery bound. Project/import/configuration changes and newly owned paths cause
fresh context discovery; `refresh: true` requests it explicitly. Closing the
native project service disposes its graph and design-time caches.

`client.service('build', 'execute', request, {signal})` exposes the same mapped
single-project build service. `projectGraphFromContexts(contexts)` constructs a
graph from supplied context data; `projectGraphFromProjectSystem(system, startup,
adaptContext)` consumes the public portable project-system closure with an
explicit context adapter. All these helpers are exported from the Node entry.

This optional skip check does not replace MSBuild target incrementality. The
reusable worker timing/cleanup qualification remains separate: no speedup is
claimed from a host that cannot create the required MSBuild worker pipe.
