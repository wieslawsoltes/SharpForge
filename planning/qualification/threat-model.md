# SharpForge threat model

Scope: [SF-A29-T34 / #504](https://github.com/wieslawsoltes/SharpForge/issues/504).
This is a source and test inventory, not a penetration-test report or a claim that all engines are secure.
The linked tests identify positive, negative and boundary cases; their existence does not establish a passing run
on any particular commit, browser, operating system or deployment. No tests were run for this documentation change.

## Assets and attackers

Protect source and generated artifacts, selected disk files, browser storage, native build credentials/session tokens,
network credentials and responses, and availability of the UI and host. Inputs include C#/IL/PE files, projects/XML,
archives, network replies and extension output. Attackers can supply malformed or adversarial inputs, control a granted
remote endpoint, induce a visit to a hostile website, or modify dependencies. A compromised application origin, host
account, trusted extension or native build dependency already has authority that the managed VM does not restrict.

## Browser application and managed execution

**Assets:** workspace confidentiality/integrity, UI responsiveness, browser storage and explicitly granted network access.
**Attackers:** a project or assembly author, malicious network endpoint, or website trying to cross origin boundaries.

The compiler/VM executes a defined instruction and intrinsic set rather than translating a program into host JavaScript.
The managed surface has no general DOM, arbitrary host-object, filesystem or process-launch bridge. Bytecode and PE/CIL
loaders validate supported formats; unsupported instructions/imports fail. These checks are not a formal memory/type
safety proof. Same-origin popouts are part of the trusted application, not isolation between tenants or plugins.

Networking is denied until the host grants an exact HTTP(S) origin. Managed `HttpClient` uses the bounded transport;
JavaScript WebSocket clients use exact WS(S) grants. Origin grants permit all paths at that origin and are not DNS pinning
or a native SSRF firewall. Fetch omits credentials, refuses redirects and restricts headers; explicit authorization
headers are possible. Browser WebSocket cookies follow browser rules. CORS, mixed-content rules and deployment CSP apply
independently of session grants. Only grant endpoints whose access and side effects are intended.

CSP restricts scripts, workers and connection origins. HTTP headers and generated HTML metadata must be checked on the
actual deployment; metadata cannot enforce `frame-ancestors`. CSP does not compensate for a compromised trusted origin.
Source, image, XML and network limits reduce exposure; browser/process termination is still needed for a hard resource
boundary. Selected-file APIs and downloads reflect user grants and browser behavior, not an application OS sandbox.

Coverage inventory:

- [Sandbox fixtures](../../tests/conformance/security/sandbox.test.js): managed member/intrinsic boundaries,
  malformed images and distinct compiler/loader rejection versus managed runtime faults.
- [Resource fixtures](../../tests/conformance/security/limits.test.js): documented defaults and lowered boundaries
  in bounded subprocesses on the source and CIL VMs; no total-process memory guarantee.
- [Studio injection fixture](../../tests/conformance/browser/xss_test.py): all registered panels with markup-bearing
  filenames, metadata, output and diagnostics, plus DOM-handler/CSP monitors; execution remains scheduled.
- [Runtime tests](../../tests/runtime.test.js): ordinary execution, heap/array limits, uncatchable instruction limit,
  output bounds, yielding and stopping.
- [CIL tests](../../tests/cil.test.js): valid round trips, truncated headers, modified instructions and unsupported opcodes.
- [Network tests](../../tests/network14.test.js): real local HTTP/WebSocket exchanges; denied/wrong origins, redirects,
  headers, byte limits, queue limits, cancellation, deadlines and disposal.
- [Managed HTTP tests](../../tests/runtime14.test.js): source, reloaded image, direct CIL and reassembled CIL paths.
- [Project-system tests](../../tests/project-system.test.js) and [disk tests](../../tests/release04.test.js): valid selected
  files, XML entity/traversal rejection, bounded parsing and permission/conflict checks. Writable browser handles use mocks.
- [CSP fixtures](../../tests/conformance/security/csp.test.js): valid policy, rejected late/inactive/permissive policy,
  exact standalone hash and bounded local/HTTP probes. [Browser CSP smoke](../../tests/conformance/browser/csp_smoke.py)
  injects forbidden inline scripts/handlers using actual browser navigation; passing fixtures are not a deployed-site audit.

## Standalone HTML

**Assets:** local source, local-origin storage, generated HTML integrity and browser availability.
**Attackers:** a distributor modifying the HTML, malicious imported content, or an explicitly granted endpoint.

The standalone embeds application code/styles and starts Blob workers. It requires no external download to start;
that is not a prohibition on explicitly granted network operations. Its generated CSP permits the exact emitted inline
entry-script hash and Blob workers, without granting arbitrary inline JavaScript. Editing that script invalidates the hash.
A distributor able to replace both HTML and policy remains trusted: CSP is not a signature. File-origin worker/storage
behavior varies by browser. An embedding site's stricter policy may block execution; do not loosen a site's global policy
merely to host this artifact. Host headers are needed for directives unavailable in CSP metadata.

Coverage inventory: [standalone integration](../../tests/standalone_test.py) includes offline worker/runtime behavior and
HTTP denial before fetch; [real file navigation](../../tests/conformance/browser/standalone_file_test.py) exercises
`file://` using native browser storage; [CSP fixtures](../../tests/conformance/security/csp.test.js) reject changed script
bytes and extra entry scripts. The in-memory historical harness alone cannot qualify native file-origin behavior.

## Node CLI

**Assets:** the invoking user's files, emitted artifacts, network access and process availability.
**Attackers:** authors of input source, project files or assemblies, or a granted endpoint.

The CLI itself is trusted Node code running with the user's OS permissions. Managed execution uses VM limits and explicit
`--allow-origin` grants; these do not confine Node or stop a parser/host defect from using host authority. Project readers
reject root escapes and skip symlinks, but path checks are not protection against every concurrent filesystem replacement.
The lightweight project reader diagnoses unsupported native task/analyzer/package execution. A separately selected native
MSBuild host has the stronger trust requirement below. Use a separately constrained process/container/account when
processing hostile input. Executing an emitted assembly on native .NET is ordinary native execution, not VM isolation.

Coverage inventory: [CLI fixtures](../../tests/cil-cli.test.js) compile/disassemble/execute valid inputs and reject malformed
options; [project-system tests](../../tests/project-system.test.js) reject traversal, entities and unsupported execution;
[CLI/project cases](../../tests/release04.test.js) cover actual CLI routes. Shared runtime/CIL tests above cover logical
limits, not process memory, OS file permissions or an independent native sandbox.

## Native MSBuild host

**Assets:** all authority of the host account, workspace files, build artifacts, credentials and ephemeral session token.
**Attackers:** hostile web origins/local API callers, project authors, and compromised SDKs, imports, tasks or analyzers.

The loopback host checks exact Host/Origin, requires a bearer session token and refuses permissive CORS. The client removes
the initial fragment token from history and keeps it in memory. The startup owner chooses the executable; API calls do not
select it or invoke a shell. File APIs reject traversal/symlink components and check save baselines. Host and request trust
are both required, including evaluation: property functions and SDK resolution can execute code without a build target.

**Trusting a project trusts its native dependency chain with the host OS account.** These API controls do not restrict
native task filesystem/network access to the declared workspace. Keep the service loopback-only; do not expose it as a
multi-user service, through a public proxy or port forwarding. Cancellation terminates the child process tree where
supported but cannot reverse file writes or external effects. Output/time limits bound the adapter, not all native resource
use. See [native host trust and limits](../../docs/msbuild.md#trust-and-deployment-boundary).

Coverage inventory: [contract tests](../../tests/msbuild-contract.test.js) cover request validation, safe client requests,
fragment handling and foreign endpoints. [Native-host tests](../../tests/msbuild-native.test.js) cover real loopback HTTP,
missing authentication, hostile Host/Origin, path/symlink rejection, explicit trust, missing executables, timeout, output
limits and process cancellation. Their build engine is a process simulator; they do not certify arbitrary SDK/task safety
or equivalent cancellation behavior on every native OS.

## Trusted JavaScript extensions

**Assets:** all data and APIs accessible to the host JavaScript realm, generated sources, diagnostics and responsiveness.
**Attackers:** an extension author or compromised extension dependency; malformed additional-file input.

Generators/analyzers are explicitly trusted synchronous JavaScript callbacks. Immutable snapshots, caching, output limits
and cancellation checks constrain the driver contract, not callback authority. A callback can access host APIs, retain
objects or block its thread; AbortSignal cannot forcibly interrupt it. Studio selects built-ins. The extension driver does
not load arbitrary .NET analyzer DLLs or provide an untrusted plugin sandbox. Run untrusted extensions only behind an
independently designed isolation boundary with appropriate host capabilities and termination controls.

Coverage inventory: [extension contract](../../packages/extensions/README.md),
[language/extension fixtures](../../tests/language-ide-extensions.test.js) and
[project extension fixtures](../../tests/release06-project-extensions.test.js) cover normal generated output, diagnostics,
options and malformed schema failures. They do not prove isolation from a hostile callback.

## Static and artifact checks

The A29 `check` task runs [the static import gate](../../scripts/conformance/static/check-imports.js) within the existing
core job and writes `artifacts/security/static-imports.json`. Its exact-hash dynamic-use allowlist binds file bytes, count
and review reason. The dynamic-code scan is conservative lexical analysis, not dataflow analysis or proof that arbitrary
input cannot reach an execution API. [Static fixtures](../../tests/conformance/security/static-imports.test.js) exercise
that contract. The opt-in security workflow runs focused security tests and CSP probes against `dist/index.html` and
`artifacts/SharpForge-standalone.html`; local artifact inspection still does not certify the headers or behavior of a
remote deployment. Re-run qualification for the exact published artifacts and actual target origins.

## Resource and qualification limits

Managed heap bytes are logical accounting, not JavaScript heap, RSS, compiler/editor memory, native allocation or browser
process memory. Instruction budgets do not bound the time of every builtin. Cooperative deadlines and cancellation are
not hard wall-clock preemption; a stalled worker needs host termination/recreation, and a stalled native process needs an
OS supervisor. Output limits cannot reverse data already sent to a granted endpoint. Canonical assembly checks and
deterministic IDs are format checks, not authentication/signatures; embedded source remains readable.

This inventory does not qualify Chromium, Firefox, WebKit, file-origin storage, hosted headers, Windows/macOS/Linux native
isolation, GPU drivers, or real MSBuild toolchains. Each requires exact-source, target-specific retained results. Source VM
and direct CIL tests must remain separate from native CLR behavior. No Rust native/Wasm managed-VM security qualification
is supplied here; ordinary WebAssembly compute support does not establish that engine's existence or isolation properties.
Unknown, unsupported and unexecuted targets remain explicitly unqualified. See [operational limits](../../docs/security.md)
and [private reporting policy](../../SECURITY.md). Repository private vulnerability reporting was enabled and verified
through the GitHub repository API on 2026-10-03; the reporting link is in that policy.
