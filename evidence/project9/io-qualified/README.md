Prepared IO qualification evidence

Final local and replay-tested commit fe8288772be85395909d5de582c444db3d605ca3, tree 541c835f876aefd506ec55ee30511929f131accd; measured product f8414bfcadbab039280d580a8152ac21f9fe6452; baseline 726fbd8303042c7634a057807b51adeaddffa9a8.

Publication is pending. The planned branch is codex/project9-io-qualified-evidence and directory is evidence/project9/io-qualified. The integration owner must verify the published Git tree and replace pending PR evidence text with immutable links.

manifest.json contains exact hashes, revisions, methods, blockers and every accepted timing exception. qualification-review.md contains explicit independent Codex agent decisions, not human review. publication-plan.json records the eight-item stack, intended trees and serial publication/merge gates. Original PR descriptions are retained under metadata/original-pr-bodies/.

Final-fe qualification: an actual 278/278 test replay retains exact argv, environment, times and 18 input hashes in io-final-replay-execution.json, with raw io-final-replay-tests.tap. The earlier product TAP and the explicitly labeled input reconstruction remain separate history; the original historical argv is not invented. Static check and builds passed at product f841; non-strict structure completed with 268 existing warnings. All 29 workspace tarballs installed offline without source links and passed 45 smoke steps on Node v24.19.0.

Final budget decisions: accept 15 median and 18 p95 exceptions above 5%, and the final 11,460-byte IO package (+21.4111664%). Fresh browser growth is 8,523 bytes (+0.0077436337%). The performance/build/package-smoke revision is f8414bfc; final fe828877 changes only the README and has its own actual test replay and verified tarball. Earlier mixed-order and pre-refactor cohorts remain labeled and separate.

Actual final npm ci failed with EUSAGE because @sharpforge/bcl-io is missing from the inherited lockfile. The authoritative root package-json lease remains a coordination blocker. Local --package-lock=false setup and successful offline package smoke do not constitute clean source installation or hosted core success.
