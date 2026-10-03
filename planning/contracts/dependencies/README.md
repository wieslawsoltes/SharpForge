# Dependency diagrams

SF-A00-T09.6 / [#1097](https://github.com/wieslawsoltes/SharpForge/issues/1097) follow-up completes the existing exporter:

```sh
node scripts/planning/dag-export.js --snapshot planning/backlog.snapshot.json --output artifacts/dependencies
node scripts/planning/dag-export.js --snapshot planning/backlog.snapshot.json --area A00 --output artifacts/dependencies-a00
```

The default export writes `all.mmd`, `all.dot`, one Mermaid/DOT pair per area, and `critical-path.mmd`/`critical-path.dot`.
`--area` writes that area's pair and the global critical-path pair. Area diagrams retain direct external prerequisites.
The critical-path diagram contains only the chosen dependency chain, including inherited parent requirements.
The JSON summary prints `criticalPath`, `length` and the output filenames. Length counts tasks (zero for an empty graph),
not edges, elapsed time or an estimated delivery date. Equal-length paths use a stable lexical tie-break.

The existing `exportDag(snapshot, area)` result retains `mermaid`, `dot`, `criticalPath` and `length`; it additionally exposes
`criticalMermaid` and `criticalDot`. `writeDagExports` uses the same validated graph for every output.

Validation happens before writing diagrams. Duplicate Work IDs, dependency cycles, missing dependencies and invalid areas
remain errors. In particular, the known snapshot duplicate IDs on issues #533/#566 and #598/#599 are not collapsed,
renumbered or converted into passing diagrams. They require a separate full-reference ownership fix.

Regression fixtures in `tests/a00-09-dag-export.test.js` cover actual CLI outputs and summary length, ordering/ties, area
selection, empty/single-node boundaries, inherited dependencies and invalid graphs. They are registered by the existing
A00 manifest glob. No new workflow or product changes are required.

Implementation source base: `5108b9bf2448df5e3781a68160352e47caac4064`. Local test/build/render runs are deferred under the
implementation-first direction; these commands describe future checks, not passing evidence:

```sh
node --test tests/a00-09-dag-export.test.js
node --test tests/a00-08-governance.test.js
```

Actual Mermaid/Graphviz rendering and full-backlog export remain unqualified. This follow-up does not change readiness,
claims, dependency IDs or the broad parity denominator.
