# Object verifier main-integration evidence

The 14-file gate ran once at `f64a9daba4da3700ab8fd010f610a0fbba9dd8f9`:
80 tests passed, zero failed/skipped/cancelled. Its exact argv, cwd, source before/
after, output byte counts and timestamps are retained in the execution receipt.
This result is separate from the original 79/1 run and targeted 8/8 correction.

| Record | Bytes | SHA-256 |
|---|---:|---|
| [Integration TAP](project6-object-f64-integration.tap) | 19,958 | `5846cf3260b62fabbc8c5960117acda010cecea52a2c54eb12a86e7100987c85` |
| [Integration stderr](project6-object-f64-integration.stderr.txt) | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| [Integration receipt](project6-object-f64-integration.receipt.json) | 1,454 | `1024b110c954e0afdd941420e2546e261b4fee118c442d90722e840012345557` |
| [Source integration record](project6-object-main-integration.json) | 112,189 | `9693185fefeb8420f301d52c80545a108aa2f86bc23b42176b8eb8355389957e` |
| [Earlier core failure excerpt and steps](project6-object-pr4575-core-failure.json) | 4,848 | `5ab05775ce937a3e01adf7ca3de7204493f9bef2db74322939f20c457d4a60fd` |
| [Historical static stdout](project6-object-pr4575-static-check.stdout.txt) | 77 | `db26e153b0c4d4aff07a79bfa89b35195126740fb6979df713cf0676e47e6931` |
| [Historical static stderr](project6-object-pr4575-static-check.stderr.txt) | 94 | `efa2c0796767ca086f3d032d1bedc4a3002a555df65194f4ae54ff53a1291595` |
| [Historical static receipt](project6-object-pr4575-static-check.receipt.json) | 1,101 | `177db7659e24ed6179d5634553f4574f3014d1df696201a568d8146b74a901ef` |
| [Historical static report](project6-object-pr4575-static-imports.json) | 16,943 | `f5f91fe7b0508ba3fdc4452741d1e93688e9dac2bf034139be5f5e047c3bc6a0` |

All nine originals total **156,664 bytes**; no raw text, warning, embedded path or
zero-byte file was normalized. [manifest.json](manifest.json) records every copy
and qualification scope. Its SHA-256 is
`2ee0f3aee9951c6adf38fb154ec1fbeae3d9dece03ee1e1288266b498af3b070`.

The earlier static failure was one unreviewed import in the developer benchmark
loader. The corrected static check ran at
`ec8968879f49233b546401fb1f7407853a097454`, from
`2026-10-04T16:55:49.515433+00:00` through
`2026-10-04T16:56:01.492558+00:00`; it reported 3,740 modules and zero errors.
The subsequent main integration preserves every main policy entry plus the exact
loader hash/count entry. This directory contains no claim that the later merged
registry has already passed CI core.

The main integration preserves all eight object implementation files and all
earlier native, failure/correction and performance data. The inherited dependency
delta and three actual conflict resolutions are detailed in
[QUALIFICATION.md](../../QUALIFICATION.md#main-integration-at-f64a9daba).
The new focused execution ran from `2026-10-04T17:04:44.238866+00:00` through
`2026-10-04T17:04:49.852532+00:00`; its tree is
`7065a3d19e7bbb26f1cc2694344dc1fa6815da47`.

The native observations remain the original 52 cases at `73f9ab77`, SHA-256
`038da3f3ca12b21f39c367f726b972b0b89ded606ed66f9157ebeab495996dbb`.
The retained performance cohort remains `407ece8a` against `88c861e3`, with its
explicit automated-review exception and all adverse results. Neither native
capture nor performance was rerun for this integration. Browser qualification
and broader runtime execution remain unclaimed.
