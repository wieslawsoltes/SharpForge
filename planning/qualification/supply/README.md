# A29 T08 supply-chain gates

Tracking: SF-A29-T08 (#404), leaves #1167–#1174. This slice adds qualification and release provenance gates. It does not publish a release, enable repository settings, or claim that a remote attestation/CodeQL run has happened.

## Run the gates

Use Node 24.21 and an isolated Python 3.12+ environment. The product still has no runtime dependencies.

```sh
npm ci --ignore-scripts --no-audit --no-fund
python -m venv /tmp/sharpforge-supply-venv
/tmp/sharpforge-supply-venv/bin/python -m pip install --require-hashes --only-binary=:all: -r tests/requirements.txt
python scripts/conformance/supply/workflow-lint.py
node scripts/conformance/supply/pin-actions.js
node scripts/conformance/supply/verify-vendor.js
node scripts/conformance/supply/license-gate.js
node scripts/conformance/supply/secret-scan.js
node --test tests/conformance/supply/*.test.js
python -m unittest discover -s tests/conformance/supply -p 'test_*.py'
npm run build
npm run standalone
npm run test:packages
node scripts/conformance/repro/package-release.js
node scripts/conformance/supply/sbom.js
python scripts/conformance/supply/validate-sbom.py artifacts/SBOM.cdx.json
node scripts/conformance/supply/secret-scan.js . dist artifacts
```

Activate the isolated environment, or use its absolute Python path for every Python command. Windows uses `Scripts/python.exe`. The security workflow runs the same commands on Ubuntu 24.04, Windows 2025 and macOS 26. Those configured jobs are not evidence of successful executions; actual local and hosted results belong in the evidence record. The Python lock includes official wheels for all available platforms, not a claim that every wheel has been executed.

Ordinary pull requests retain the existing single `core` execution. Security matrix and CodeQL jobs run serially on explicit manual dispatch. There are no branch-push duplicates or `pull_request_target` jobs. Tag release qualification uses the existing reusable CI workflow.

## Action and Python lock review

`action-pins.json` records each reviewed upstream action tag, full commit and GitHub commit endpoint. Every remote action and reusable workflow must use a full SHA; container actions require a digest. Local references must exist inside this checkout. Real YAML parsing checks quoted/flow keys, duplicate keys, unsupported aliases, permissions and shell expressions. `pin-actions.js --write` applies only the recorded known major versions. It does not substitute for the semantic security linter. Dependabot proposes GitHub Actions, root npm and test pip updates weekly; review the resulting commits, metadata and hashes together.

Regenerate the Python lock in an isolated environment with an explicit complete dependency resolution:

```sh
python -m pip install --dry-run --ignore-installed --only-binary=:all: --report /tmp/supply-resolution.json playwright==1.63.0 jsonschema==4.26.0 PyYAML==6.0.3
python scripts/conformance/supply/lock-python.py --resolution /tmp/supply-resolution.json --date YYYY-MM-DD
python -m pip install --require-hashes --only-binary=:all: -r tests/requirements.txt
```

The writer obtains wheel hashes from exact PyPI version metadata and keeps all wheel URLs and dependency declarations in `python-lock.json`. It records roots using the resolved versions of entries marked `requested` in the pip report. Review transitive versions and licenses as well as the root versions. A regenerated metadata record may need an explicit upstream license citation when PyPI omits its license field. Do not remove hashes, use source distributions, or accept a tampered wheel to make installation pass. The regression suite creates an owned local wheel and demonstrates actual pip acceptance/rejection without a network dependency.

Test-only `jsonschema` and `PyYAML` were explicitly authorized for this scope. The existing Node schema subset cannot validate the complete official CycloneDX Draft 7 schema, and regex parsing cannot enforce YAML semantics. Reimplementing either standard would increase the attack surface and miss valid/invalid cases. These two tools and all transitives are confined to the hash-pinned qualification environment; none enter npm packages, browser bundles or application runtime imports.

## Vendor, licenses and SBOM

The historical vendor origin remains the recorded nbclassic installation. For this change, the exact npm CodeMirror 5.58.3 tarball was downloaded and hashed; its original nine JavaScript files match every previously recorded upstream SHA. The manifest now also records the two upstream CSS hashes. Eleven bounded reconstruction segments reverse only the declared JavaScript UMD/owner-document wrappers and CSS concatenation, recovering each original upstream hash offline. The checked-in JavaScript, CSS and license bytes are unchanged. The retained license email differs from npm's notice; permission text is the same, and both exact notice hashes are recorded without rewriting history.

`licenses.json` explicitly records asset/vendor file bytes, origin, license text and the notice that covers each file. New fonts, icons, images, audio, archives, assembly/PDB assets, vendor files and vendored schema files fail unless listed. Third-party source belongs in a declared vendor/third-party directory and must receive its own record; repository authors remain responsible for identifying copied source that has no machine-recognizable origin. A license declaration is not proof of authorship. Existing first-party artwork and example assets retain the repository MIT declaration; the gate does not invent an upstream artist or download source.

The CycloneDX schemas are unmodified upstream files from the immutable commit recorded in `cyclonedx/origin.json`, with the upstream Apache-2.0 license retained. The full official schema is resolved locally without schema-network access. SBOM components cover every actual dist file, standalone HTML, each actual workspace tarball, browser archive, all workspace packages, CodeMirror 5.58.3 and its shipped bytes. Missing/extra tarballs and missing payloads fail. Build tooling is documented separately and is not misrepresented as distributed runtime code.

License decisions and upstream/wrapper changes require review of origin, allowed license, complete notice text, byte hashes and reconstructed original files. Do not blindly regenerate the allowed-assets list from the tree: that would turn an unknown license into an invented approval.

## Secrets and workflow policy

Pattern rules identify common GitHub, AWS and Slack token forms and private-key headers. Entropy checks inspect secret-like assignments. Results contain location, rule and SHA-256 only, never matched values. There is no broad placeholder exemption. File count, file size, total bytes and findings are bounded; excess input fails closed, and asynchronous tree traversal supports cancellation. Line indexing is linear in file size, followed by logarithmic location lookups per finding.

The scan includes committed docs/result files and the actual uncompressed dist and standalone files. Binary archives are scanned as raw bytes in addition to their separately scanned build inputs; this is not a generic archive-unpacking service. Known payload hashes and release seals bind the archives and packages to qualified inputs. The planted-token regression creates a real temporary Git fixture branch and then a built-bundle fixture; neither contains a usable credential.

GitHub repository administrators can enable **Settings → Security → Advanced Security → Secret Protection → Push protection** where available. Follow the [GitHub push-protection documentation](https://docs.github.com/en/code-security/secret-scanning/protecting-pushes-with-secret-scanning) and review permitted bypasses. No setting was changed by this work. Repository scanning supplements provider-side protection and does not promise detection of every possible credential.

Workflow permission writes are individually allowlisted by job in `workflow-permissions.json`. Repository-wide writes, unpinned uses, `pull_request_target`, and direct untrusted expression interpolation into shell scripts fail. Matrix interpolation is accepted only when every declared value, including overrides, is a safe literal. Pass untrusted text through an environment variable and quote its shell expansion; do not use eval. CodeQL analyzes JavaScript/TypeScript and Python; it does not qualify native C#/Rust code.

## Release trust and limitations

The existing qualified browser/package jobs now create exact byte inventories with the checkout commit before artifact upload. Release assembly verifies those seals before packaging and builds a full SBOM. Build/attest has contents read plus the required OIDC, attestation and artifact-metadata writes; only publish has contents write. Both jobs verify every asset with the real `gh attestation verify`, binding repository, signer workflow, source commit, tag, hosted runner and SLSA provenance type. Verification errors, empty results or missing assets stop publication. Publishing does not rebuild a payload.

`SOURCE-MANIFEST.json`, `SHA256SUMS`, SBOM and all browser/standalone/package assets are signed and verified. Verification outputs are retained for 30 days. Signatures can only be positively qualified in GitHub's OIDC environment; local tests validate subject membership, changed payload/commit rejection and exact verification policy. A release has not been created, and no successful signature-verification claim is made before that hosted execution.

The integrated release workflow uses `node scripts/conformance/repro/package-release.js` and uses its explicit `source-manifest.js --verify-payloads` in the artifact-only publish job. T09 preserves exported `verifyManifest(directory, manifest)` as payload verification; strict full release-tree verification is separate. The temporary T08 archive helper is removed. Qualified build/package producers use the reviewed Node 24.21.0 and npm 11.19.0 toolchain. See [the integration record](release-integration.md) for updated asset origins and deferred combined validation.

For tooling cost, after committing and cleaning the tree run `node scripts/conformance/supply/benchmark.js`. It records one first execution and twenty warm executions of each actual source gate, median/p95/p99 and raw samples. Retained JS heap deltas are not total or native allocation measurements. These scripts do not enter any product hot path. Results and explicit platform/remote-execution limitations are recorded alongside the validation evidence.

## Captured local evidence

`evidence/macos-arm64-2026-10-03/results.json` maps all eight leaves to retained raw output at source commit `b6a47980eaffe24f01f94da36d1e43d836366de9`. On macOS arm64 with Node 24.21.0 and Python 3.14.7: 2,834/2,834 core tests, 12/12 Node supply tests, 8/8 Python tests, syntax checks, semantic workflow lint and actionlint 1.7.12 passed. All 25 tarballs passed installed-package tests at `938ef79`; package/product inputs are unchanged between that commit and the final source commit. Build, standalone, seals and the 906-component full-schema SBOM passed. The structure command reports inherited advisory findings; no new supply file is among them.

The actual hash-enforced pip installation contains all ten locked tools. Retained installed-wheel license observations include Playwright's Apache-2.0 `License-Expression` and exact license-file digest; its PyPI JSON happens to omit that field. No missing metadata was treated as proof of a license.

Source scans included documentation/result files and returned zero findings. The source-plus-built scan covered 2,217 files / 51,741,444 bytes before evidence was added. Gate cost was measured on an otherwise idle Apple Silicon host, with one first execution plus twenty warm samples each: vendor median 1.38 ms / p95 1.76 ms; asset licenses 21.98 ms / 22.81 ms; source secret scan 293.95 ms / 362.82 ms. Raw timing and retained-heap samples are retained. These are descriptive new-tool costs, not a product speedup or native-allocation claim.

Linux/Windows executions, hosted CodeQL findings and successful GitHub OIDC signing/signature verification remain unqualified until those configured jobs actually run. In particular, #1173's positive remote `gh attestation verify` acceptance criterion is pending a real authorized tag-release qualification; this implementation has not created or published such a release. Browser rendering and VM backends are unaffected by these tooling-only changes.
