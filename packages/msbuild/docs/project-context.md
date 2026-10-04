# Immutable project context contract

`createProjectContext(input)` returns a deeply immutable version 1 snapshot with an identity made from project, configuration,
platform, target framework and runtime identifier. Sources, generated files, references/aliases, compiler options, analyzers,
additional files, diagnostics, artifacts, global properties, imports and project references stay attached to their exact context.

`contextFromEvaluation(project, evaluation, options)` consumes actual MSBuild properties/items and parsed CscCommandLineArgs.
Unknown compiler switches are retained explicitly. `contextFromPortableEvaluation(evaluation)` adapts an existing portable
snapshot to the same contract; it does not invent SDK metadata availability. Both adapters use the shared public runtime graph.

`projectContextCompilationOptions(context)` normalizes the compiler option shape without reading paths. The corresponding
`projectContextCompilationInput(context, sourceRecords)` accepts a Map or explicit records and preserves generated/read-only
identities. Missing source contents throw SFMSB_CONTEXT_SOURCE_MISSING. At most 10,000 source identities and 100,000 object nodes
are admitted. These helpers do not execute a build, read arbitrary host paths or start analyzers.

`projectContextId` and `ProjectContextSelection` reuse the public project-system definitions; the native package does not
maintain a second identity serializer or selection model. Runtime graph helpers are similarly re-exported from the shared owner.
The selected context can change without dropping diagnostics and labels from inactive target frameworks.

Reference alias metadata uses the evaluator's shared case-insensitive lookup, preserving explicit aliases across context adapters.
