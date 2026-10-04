# Native-width and byref qualification harness checkpoint — 2026-10-04

At revision `46ed6141a29e2a08523449a9ca89ce395d8e9e07`, tree
`2b7e28c4de03ff6c305668d2e882ac654be2500f`, the focused selection passed
**28/28 tests, with zero failures or skips**, in `6129.876855 ms`.
The same revision passed `npm run check` and the oracle license-policy check.

| Retained output | Result |
| --- | --- |
| [Focused tests](a05-native-new-criteria-focused.log) | 28 passed; zero failures, skips or cancellations |
| [npm check](a05-native-new-criteria-npm-check.log) | 1295 Node test files, zero unassigned; 4629 modules with zero syntax errors; static imports inspected 4580 and linked 4617 modules |
| [License policy](a05-native-new-criteria-license.log) | Passed: 7 tools, 14 packages, 4 actions, 3 images and 14938 tracked paths |

The [original journal](a05-native-new-criteria-journal.json) retains exact
commands, full revision/tree, working directory, resource environment, start/end
times and exit codes. The [manifest](manifest.json) hashes all four original
files. Outputs are preserved byte-for-byte. An initial argument inventory named
a nonexistent test file; preflight stopped before tests started. The journal
retains that distinction and the corrected six-file selection.

These checks cover the authored native-width/byref harness and source-route
behavior. The expanded native plan defines 34 cases across six SDK/OS cells,
plus two targeted Windows x86 width checks pinned to SDK 8.0.425 and 10.0.201.
Actual execution of that expanded CI matrix remains pending. No fresh CLR,
Windows x86 process, browser, ABI32 native result or performance qualification is
claimed by these local checks. Their counts overlap earlier selections and must
not be added. The parent runtime/build source was unchanged by this harness/test
batch; prior build results remain attached to their original revisions.
