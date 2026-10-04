# Incomplete full A05 attempt at 001a

This attempt is **incomplete**, with **no observed exit code and no final TAP
summary**. The retained log contains 3,775 `ok` lines and 17 `not ok` lines and
stops after `ok 3792`. These are observations of emitted lines, not final test
counts and not a completed pass or failure qualification.

The [initial execution record](full-a05-manifest-execution.json) identifies
commit `001a5ccc899ae517e430866d4d1ba03d89def346`, tree
`9915d20c63a3ba9a9c81f1153a13dbcf6fbbc99b`, clean start state and the exact
manifest-selector command. It records Node v24.19.0, one run slot, serial tests,
a 512 MiB V8 cap, `--expose-gc`, TAP output, and the selected SDK10 host/framework.
The command started at 2026-10-04T21:45:16.855660+00:00. The initial record has
not been amended with a manufactured completion or exit value.

The [independent interruption observation](full-a05-manifest-interrupted-observation.json)
was recorded at 2026-10-04T22:05:15.703643+00:00 after execution session 20968
became unknown. It records all five identified wrapper/runner/numeric-child
PIDs as absent. The then-current repository identity remained the same clean
001a commit/tree. This later identity is an observation, not the command's
end identity; the interruption cause and exact termination time are unknown.

[manifest.json](manifest.json) records exact bytes, source paths and SHA-256
hashes for the [raw log](full-a05-manifest.log) and both original JSON files.
All three are byte-identical copies from the command-capture directory.
The manifest lists the 17 observed failures: nine async/interface/layout
failures and eight stale engine-parity fixture expectations. Subsequent
repairs and passing focused rows cannot retroactively complete this attempt.

The absence of a final summary prevents a full A05 qualification claim and
prevents treating the unfinished numeric corpus as passed. No browser, release
asset, build-size or performance qualification is implied. No tests, builds or
checks were run to prepare this archive; raw diagnostic whitespace is retained.
