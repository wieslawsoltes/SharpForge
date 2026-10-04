# Automated performance disposition: integrated PE bounds

**Decision: accept the measured regressions as an explicit correctness-cost exception under CONTRIBUTING section 4.** This is automated reviewer sign-off by the task coordinator. It is not a 5% threshold pass or human approval.

Reviewed 2026-10-04T20:53:28.761160+00:00. Candidate `ddf3da105ace61ed61463a5704caf93c0c3dcf6f`, product `8f0f0feec8ed8955e6119a346051ec6fdd965760`, baseline `f009e2949f3311f0ca84a4a6bc694535140d130b`.

The product now validates header coverage, safe raw/RVA ranges and forbidden section/header overlap before address translation. Two sorted interval indexes keep construction at O(s log s), extra storage at O(s), and reuse the existing 96-section cap. The accepted cost supports deterministic malformed-input rejection without pairwise section scanning.

## Measured latency

Values are microseconds per public `readPE` operation, summarized from 100 measured batch means after 20 warmup batches in each fresh worker. Each baseline/candidate pair uses fixed identical inputs and operation counts.

| Input | Baseline median / p95 / p99 | Candidate median / p95 / p99 | Change, % |
|---|---:|---:|---:|
| small | 15.867406 / 158.667008 / 224.414805 | 21.291738 / 106.872031 / 178.692898 | +34.1854 / -32.6438 / -20.3738 |
| dense96 | 61.733781 / 119.839438 / 167.299156 | 67.726344 / 134.387656 / 178.295906 | +9.7071 / +12.1398 / +6.5731 |
| il | 56.582469 / 199.252156 / 330.266922 | 56.504070 / 220.271281 / 244.236953 | -0.1386 / +10.5490 / -26.0486 |
| r2r | 133.979760 / 521.370040 / 631.880320 | 140.059280 / 534.048280 / 663.672240 | +4.5376 / +2.4317 / +5.0313 |
| mixed | 103.104820 / 514.508800 / 658.593600 | 89.921260 / 498.205240 / 591.025160 | -12.7866 / -3.1688 / -10.2595 |

Small-image median increased by **5.424332 µs (+34.1854%)**; the 96-section median increased by **5.992563 µs (+9.7071%)**. Those costs and the adverse tails below are accepted for this bounded correctness change. They are not dismissed as noise or collection effects.

## Every adverse predefined latency statistic

| Input | Statistic | Baseline µs | Candidate µs | Change |
|---|---|---:|---:|---:|
| small | median | 15.867406 | 21.291738 | +34.1854% |
| small | min | 11.741930 | 12.594508 | +7.2610% |
| dense96 | median | 61.733781 | 67.726344 | +9.7071% |
| dense96 | p95 | 119.839438 | 134.387656 | +12.1398% |
| dense96 | p99 | 167.299156 | 178.295906 | +6.5731% |
| dense96 | min | 52.112469 | 53.204063 | +2.0947% |
| il | p95 | 199.252156 | 220.271281 | +10.5490% |
| r2r | median | 133.979760 | 140.059280 | +4.5376% |
| r2r | p95 | 521.370040 | 534.048280 | +2.4317% |
| r2r | p99 | 631.880320 | 663.672240 | +5.0313% |
| r2r | min | 118.155080 | 119.348880 | +1.0104% |

Seven of these eleven adverse statistics exceed 5%; six are among median/p95/p99 and the seventh is the small-image minimum. The complete favorable and adverse distributions are retained. Supplemental arithmetic means also increase for small, dense96 and R2R; they are included in the JSON review and this exception. No additional cohort was run.

## Memory observations

Signed net heap deltas are per measured batch, with varying fixed operation counts across workloads. These measurements include temporary objects and collection effects; they do not measure allocation rate, retained heap or peak RSS.

| Input | Operations per batch | Baseline median heap delta, bytes | Candidate median heap delta, bytes |
|---|---:|---:|---:|
| small | 128 | 3,495,880 | 3,815,672 |
| dense96 | 32 | 3,924,456 | 4,524,024 |
| il | 64 | 7,249,692 | 7,409,724 |
| r2r | 25 | 7,562,184 | 7,623,304 |
| mixed | 25 | 4,716,760 | 4,792,416 |

All heap p95/p99/min/max and signed observations are retained in the independent and root JSON reviews, including negative deltas. These observations are explicitly accepted with the latency costs; no favorable collection interpretation is claimed.

## Evidence and limits

The fresh native and strict-source phases passed 58 authored cases and three real images; the focused gate passed 91/91. The native relation is specifically header acceptance: 20 cases agree in accepted facts, 30 are deliberately stricter product rejections, and eight are rejected by both. Input assemblies were inspected, not executed.

The performance phase completed once from 20:42:38.935207 to 20:43:05.286953 UTC on 2026-10-04. All 12 children were serial, all stderr streams empty, all source identities unchanged and all output guards passed. It retains 1,200 chronological rows, 10,960 warmup calls and 54,800 measured calls, plus 60 untimed worker preflight reads. The independent review verified 52 raw files totaling 4,265,710 bytes.

The host was shared Linux x64, Node v24.19.0, AMD EPYC 9V74 with nine logical CPUs exposed. Team source work was paused; no competing workload was observed at preflight. Single-cohort results do not establish cross-machine significance or attribute individual distribution changes to one line of code. No forced GC was used.

No browser/OS engine matrix or cancellation injection is claimed here. Tracking issue #2417 remains open. Original native and benchmark evidence stays byte-for-byte historical; these integrated results govern the updated PR.

Independent review SHA-256: `100f231ce5da5859d0017c7e684c2202601f40dd5490249046f33ebe1f24ed18`.
Root review SHA-256: `c637b972f58a8093ce2c1896865a08344be3e62ea1845aa52c0c20ffac55b69c`.
See `root-integration-f009-performance-review.json` for exact raw-source identities, all values, additive means and the complete disposition.
