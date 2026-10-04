# Native binary log inspection

The native service replays a retained build job's binary log through the installed
SDK's `Microsoft.Build.Logging.BinaryLogReplayEventSource`. It builds the small
bundled helper against that SDK's Microsoft.Build assemblies, without an external
NuGet package. Reading real gzip/event/name-value/string tables stays with the
versioned Microsoft reader. Forward-compatibility warnings are preserved.

`NativeBinlogReader(engine, options)` is exported from the Node entry. `query(jobId,
options)` resolves only a retained job's binlog artifact under its granted workspace.
The host registers `binlog/query`; the browser calls `client.binlog(jobId, query,
{signal})`. First access prepares/replays the log; subsequent queries reuse the
bounded structural index and disk spool. SDK absence, malformed input, missing
artifacts, replay failure and exceeded budgets fail explicitly.

The browser-safe `BuildEventModel` retains project/target/task structure, warning
and error counts, and start/end durations. `page(parentId, {offset,limit})` returns
at most 1,000 children; `timings({kind,limit})` selects project, target or task
durations. Parallel node durations overlap; their sum is not build wall time.

Node helpers `indexBinlogEvents(path, options)` and `queryBinlogEvents(path, options)`
consume the UTF-8 NDJSON spool incrementally. Event pages use a byte cursor that
survives Unicode. Search stops after at most 50,000 scanned events per request.
When the response budget is reached, the first unreturned event remains available
at nextCursor. Queries accept cancellation and close their stream in finally.

Default bounds are 512 MiB compressed input, 1 GiB spool, 100,000 structural nodes,
32 MiB estimated model storage, 4 MiB per event, 8 MiB per event page and eight
retained replay results. The helper additionally bounds replay to ten million
events and enforces a 512 MiB process working set. Structural strings, requested
page sizes, scan counts and configurable query/model budgets are validated.

The large-log qualification uses an actual compressed log above 200 MiB, created
by the official MSBuild BinaryLogger. It measures helper and Node RSS separately,
checks each below 512 MiB and their conservative peak sum below 1 GiB, and resumes
pages across the resulting spool. Enable it only for complete-scope qualification
with SHARPFORGE_LARGE_BINLOG=1 and an explicit SHARPFORGE_DOTNET toolchain.
Platform and SDK versions, input/spool sizes and measured peaks are recorded in
the evidence; unrun OS/architecture combinations are not reported as passes.
