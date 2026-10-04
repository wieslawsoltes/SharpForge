# Project16 static and standalone workflow qualification

Work IDs: SF-A19-T12.2 (#1583), SF-A19-T11.3 (#1580).

`tests/browser_vs_workflows_test.py` owns the shared project creation, shared-document
edit, build, source breakpoint, step/continue, designer edit/undo/redo/save and ZIP
export assertions. Empty project names must display a diagnostic and block creation.
Project creation still requires the modal to close; a caught product error now
surfaces its actual wizard diagnostic instead of becoming an opaque timeout.

`tests/browser_vs_workflows_standalone_test.py` calls that same workflow with its
own suite identity and `mode='file'`. It navigates directly to the resolved
`artifacts/SharpForge-standalone.html` with `file://`; `SHARPFORGE_STANDALONE_PATH`
can select another generated artifact. The report records its SHA-256 and byte
length. Missing artifacts, redirects away from the file, missing/weak CSP or
in-memory substitution fail explicitly. It never uses `set_content`, replaces
native storage, disables browser policy, or substitutes an HTTP server for file
loading. Both modes exercise the existing first-run/start UI helper.

The standalone browser context is offline before navigation. HTTP(S) attempts are
recorded and aborted; any attempted request fails the workflow, including a failed
request that a tool catches. The common launcher still monitors actual production
CSP violations. The standalone entry's generated CSP meta must precede all scripts,
include its script hash, reject `unsafe-eval`/`unsafe-inline`, and deny object sources.

Standalone additionally activates assembly, disassembly and MSBuild tool panels,
checks their actual tool-specific content, and reopens each with one mounted host.
Wizard creation and designer edits provide the remaining first activations; their
reopening checks retain the wizard UI and designer document. These use the public
Studio commands, not replacement factories or module instrumentation. The MSBuild
panel must work offline; invoking an OS SDK is a separate native-host qualification.
The report does not infer module evaluation counts from HTTP requests in a bundle,
nor claim controller construction counts when no public counter exists.

Reports remain separate: `vs-workflow-results.json` and
`vs-workflow-standalone-results.json`. Traces, screenshots and session metadata use
their distinct entrypoint names. Session metadata records the exact selected
engine and `http` or `file` loading mode. Debugger backend evidence is captured from
the actual completed debug snapshot's profile/statistics before Stop; it is no
longer a hardcoded source-VM claim. Reports survive failures and cancellation.

Focused driver contracts are in
`tests/conformance/browser/test_workflow_loading.py`; they cover direct navigation,
artifact identity, path spaces, missing artifacts, rejected CSP/redirects,
forbidden in-memory substitution, offline request capture and distinct failure
reports. Those unit fixtures are not browser/runtime evidence.

## Validation state

This source-only correction was authored from main
`e990e9342678117090a48516ec736d92104be4b2`. No tests, builds or browser runs were
executed during implementation, as requested by the integration owner. The owner
will run the completed correction cohort and retain each engine/platform result.
Actual file-mode workflow success is pending that run. Unsupported browser/native
targets must remain explicit rather than being labeled passed.

After the ordinary build and standalone artifact generation, the entrypoints are:

```sh
python tests/browser_vs_workflows_test.py
python tests/browser_vs_workflows_standalone_test.py
PYTHONPATH=tests python -m unittest conformance.browser.test_workflow_loading
```

Run them through the repository's scheduled serial validation wrapper. The
historical before/after initial script-evaluation measurement required by #1580
remains separate evidence; neither successful activation nor this workflow's
elapsed time establishes that reduction.
