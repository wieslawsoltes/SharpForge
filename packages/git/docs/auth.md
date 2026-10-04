# Git authentication, provider APIs and origin permissions

SharpForge's Git authentication runs in an explicit session. Credentials enter a private vault, network
provider requests receive credentials only through an `Authorization` header, and each remote has a separate list
of permitted origins. Provider operations work through the same permission rules in the browser, a worker
and a native host.

## Sign in and authorize connections

Open **Git settings** to enter the commit author identity and select credential storage. A personal access
token is the default sign-in method. The authentication dialog lists the origins that the sign-in action
will grant. Token entry is cleared as soon as the worker has accepted it or the dialog is cancelled.

The supported credential schemes are:

| Provider | API token header | Smart Git token header |
| --- | --- | --- |
| GitHub | Bearer | Basic, username `x-access-token` |
| GitLab | Bearer | Basic, username `oauth2` |
| Bitbucket Cloud | Bearer for OAuth; Basic when a PAT email/username is supplied | Explicit credential scheme |
| Azure DevOps | Basic with an empty username for PATs; Bearer for Entra OAuth | Same credential-type distinction |
| Gitea | Bearer | Explicit credential scheme |

Host comparison uses parsed, exact origins. Granting `https://github.com` does not grant
`https://github.com.example` or `https://api.github.com`. A GitHub remote proposes exactly GitHub.com and
api.github.com. Self-hosted GitLab and Gitea require an explicit provider selection and exact server origin.

A connection grant is distinct from permission to forward credentials to a proxy. The protocol adapter
requires both the proxy's connection grant and request-local `credentialForwardOrigins` consent before
forwarding an upstream Authorization header. Anonymous requests do not install a credential callback.
LFS storage actions have a separate `actionCredentialOrigins` and `actionCredentialConsent` contract.
It permits only the server-provided action token at an explicitly granted storage origin. The transport
requires `credentialProvider:null` and no proxy for that purpose, so it cannot forward the vault token
under an action-token grant. A batch response alone never grants a new storage recipient.

OAuth needs an application registered by the deployment owner. Git settings accepts only public
configuration: client ID, broker origin, registered callback URI, requested scopes and Microsoft Entra
tenant. It has no client-secret field. Leave the client ID empty to use token entry alone. Register the
same-origin `git-oauth-callback.html` URL for browser sign-in, and enable device authorization on the
provider registration when using a device code. The settings store retains this public configuration
and connection grants; credentials remain in the worker vault.

`createGitAuthSetup({settings,grants,invoke,remote,provider,remoteId})` builds the device and PKCE actions
for `showGitAuthentication`. Creating it performs no request and grants no origin. The sign-in dialog
shows the required origins, and only the selected action grants them. A popup is created synchronously
from the button action before asynchronous grant registration, so browser activation is preserved.

### Content Security Policy

Runtime origin grants cannot relax the `Content-Security-Policy` delivered by the host. The settings page
displays the complete required deployment policy whenever remotes or the proxy change. Apply that policy
to the server/CDN before using a newly granted origin. The existing development server reads explicit
origins from `SHARPFORGE_CONNECT_ORIGINS`; it does not add public proxies or hosting providers by default.

`GitOriginGrants.toNetworkPolicy()` and `.createCsp()` reuse the public `@sharpforge/network` policies.
They preserve the existing script, worker, frame and form restrictions and change only the explicit
connection-origin list.

## Session and encrypted storage

`CredentialVault` starts in session mode. A new worker, page or vault does not recover session tokens.
The optional encrypted mode requires `enablePersistence({consent:true})`. It stores the complete
credential record as AES-256-GCM ciphertext in IndexedDB, with a fresh 96-bit nonce and the credential
identifier included in authenticated additional data. Its WebCrypto key is non-extractable and stored as
a CryptoKey in the same IndexedDB database. Tokens are never written to localStorage or sessionStorage.

Encrypted storage prevents a plaintext scan of IndexedDB values from finding tokens. It does not protect
against code that already controls the same origin and can invoke the stored key. The existing CSP and
script isolation remain necessary. Disabling persistence decrypts into the current session and removes
the database records and encryption key.

`list()` and JSON serialization return metadata only: identifiers, providers, scopes, scope state/source, permissions, origin
bindings and expiry timestamps. `get(id,{origin})` rejects a credential recipient outside the binding.
Every vault operation is bounded, and invalid ciphertext fails authentication before returning a value.

## OAuth flows

### Device authorization

`OAuthDeviceFlow` implements RFC 8628 with GitHub and Microsoft Entra v2 endpoint presets. The device code
stays private to the flow; UI callbacks receive only the user code, verification URI, lifetime and polling
interval. `authorization_pending` preserves the interval, `slow_down` increases it by at least five
seconds, and denied, expired, cancelled or excessively long flows stop with a stable `GitError`.

The host must register its own client ID and grant the authorization-server origins. For Entra, select
the appropriate tenant and Azure DevOps delegated scopes; the resource identifier is
`499b84ac-1321-427f-aa17-267ca6975798`. The browser host must also support the authorization endpoint's CORS
policy, or provide an approved server/native request implementation. Device-flow registration and live
tenant/account qualification are deployment steps and are not exercised by fixture tests.
When a broker is configured, device initiation and polling use its fixed provider endpoints instead
of depending on the provider's browser CORS policy. Device grants do not transmit an application secret.

### PKCE and callbacks

`OAuthPkceFlow` generates a random verifier, S256 challenge, state and nonce with WebCrypto. Pending
transactions exist only in memory. Callback origin, path, fixed query parameters, lifetime and state must
match. Consuming a transaction deletes it before code exchange; a repeated callback cannot retry a code.
The code and verifier are sent in the token exchange body and are not persisted.

`git-oauth-callback.html` loads an external module, has no inline script and removes the temporary code
from browser history before returning the callback to its exact same-origin opener. The opener checks
the popup WindowProxy and origin before completing the pending transaction.

OIDC sign-ins that request `openid` must supply a real `validateIdToken` implementation that verifies
the ID token and returns claims. The flow requires its verified nonce to match; decoding an unsigned JWT
is not treated as authentication.

### Token exchange broker

GitHub's web flow requires a server-side client secret. The browser offers PKCE for GitHub only when a
broker is configured. `OAuthTokenBroker` uses six endpoints:

| Endpoint | Request purpose |
| --- | --- |
| `POST /oauth/begin` | Bind state, S256 challenge, provider and registered redirect URI to a short-lived transaction |
| `POST /oauth/exchange` | Consume that transaction and exchange the one-use code and verifier |
| `POST /oauth/refresh` | Refresh a known provider's token |
| `POST /oauth/revoke` | Invoke that provider's configured revoke endpoint |
| `POST /oauth/device/start` | Request a device code for the broker's registered public client |
| `POST /oauth/device/poll` | Poll that provider's fixed token endpoint and preserve RFC 8628 pending/slow-down errors |

The reference `createTokenBroker` in `packages/git/broker/token-broker.js` is a fetch-style server handler;
`packages/git/proxy/token-broker.js` exposes the same contract from the proxy package path. Register exact
application origins, provider token/revoke URLs, client IDs/secrets and redirect URIs on the server. Only
registered upstream endpoints are reachable; browser requests cannot choose an arbitrary destination.
Responses are bounded and non-cacheable, redirects are rejected, and provider error descriptions and
client secrets are never returned to the browser. Deploy it behind HTTPS using the host's normal server
adapter. The implementation does not deploy or sign in to an account automatically.

### Token lifetime and GitHub Apps

`CredentialLifecycle` refreshes ahead of expiry and shares one refresh across concurrent requests.
`run()` retries one request after a 401 and one refresh; another rejection is terminal. Logout immediately
aborts the session signal, invokes the registered provider revoke function once, waits out any refresh,
and clears local credentials even if remote revocation fails. A completed refresh cannot resurrect a
logged-out credential.

`createGitAuthContext` registers refresh/revoke handlers for its supported providers. OAuth credentials
retain only the public registration and remote binding needed to renew a token after encrypted-vault
reload. Refresh and revoke endpoints are derived from that binding, and every request checks the current
origin grants. Where the public provider API has no configured revocation endpoint, logout reports
`remoteRevoked:false, reason:'provider-portal'` and clears the local credential. It does not claim that the
provider token was revoked. Session disposal cancels outstanding jobs without revoking persisted accounts.

Scope observations are tied to both the originating session and its actual access token. They serialize
with refresh and cannot restore a credential during logout or grant a replacement token stale scopes.

`GitHubAppSession` lists installations, requires an available installation selection, lists its permitted
repositories and exposes broker-backed refresh/revoke handlers. Revoked or suspended installations report
`GitError.Auth`. App registration, client secrets and installation private keys stay outside the browser.

## Write permissions and provider clients

The vault records actual scope evidence with `scopeState:'known'|'unknown'` and `scopeSource`.
`permissionStatus()` distinguishes `known-sufficient`, `known-insufficient` and `unknown`. A PAT entered
in Studio begins unknown. An explicitly observed empty scope set is known and insufficient.

`git.auth` method `inspectCredential` accepts `{credentialId,remoteId,remote,operation}`. It returns
permission metadata, never tokens. GitHub classic/OAuth credentials use the actual `X-OAuth-Scopes`
header from `GET /user`. GitHub App and fine-grained PAT permission models do not use that header;
neither an empty OAuth header nor `X-Accepted-GitHub-Permissions` establishes their effective rights.
GitLab PATs use `GET /api/v4/personal_access_tokens/self`. Its standard `scopes` are recorded directly;
new granular resource permissions remain unknown until their effective rights can be evaluated.

Current Gitea uses `GET /api/v1/token`, which returns the authenticated token's actual `scopes` without
an account password. Older Gitea versions that do not provide this route remain unknown. The distinct
`/users/:name/tokens` management API requiring a password is never used for inspection.

Bitbucket and Azure PATs do not expose a supported complete self-inspection API with the selected
token. Azure PAT management requires a separate Entra credential. These credentials remain unknown;
no broader credential is requested for inspection. Repository role fields never become token-scope evidence.

Provider-confirmed OAuth responses and optional trusted host-supplied permission metadata are also
supported. Fine-grained permissions can be represented explicitly as `permissions:{contents:'write'}`.
Only a provider response or trusted host integration may supply this metadata; the PAT dialog has no
field for manually asserting scopes. OAuth responses that omit `scope` do not imply requested scopes.
Azure scope checks include the documented `vso.code_manage`, `vso.code_full` and `vso.work_full`
inheritance. A provider-confirmed Entra `user_impersonation` scope grants the corresponding API access;
the requested `.default` scope alone is not evidence of a write permission.

`GitPermissions.assertWrite()` blocks known-insufficient permissions before any network mutation,
regardless of confirmation. Studio's blocking dialog lists the required scope alternatives. Known scopes
covering an operation still require confirmation, and the provider enforces repository/branch access.
Worker operations accept request-local consent bound to `{remoteId,scope,confirmed:true}`, where scope
is `push`, `pullRequest` or `issue`. Another remote or operation cannot reuse the confirmation.

Unknown permissions are blocked by default. `requestGitWriteConsent()` in Studio first inspects the
credential, explains the missing evidence, and requires a separate unchecked acknowledgment before
enabling **Attempt This Write**. Only then may the exact request add `allowUnverified:true`. The provider
enforces that single requested action; success or failure does not invent granted scopes. The flag is
never stored in settings or the vault. A plain `confirm:()=>true` cannot authorize unknown permissions.

`ProviderClient` has ETag caching isolated by credential identity, bounded response streaming, request
timeouts, explicit API-root checks, and pagination for Link headers, GitLab page headers, Bitbucket next
URLs and Azure continuation tokens. It rejects cycles, cross-origin links, oversized pages and API-root
escapes. Rate limiting retries at most three times after 429 or signalled secondary 403 responses, respects
Retry-After, and fails rather than retrying earlier than a configured maximum wait permits. Mutation
requests are not retried after ambiguous network failures.

All five provider adapters implement listing, creating and updating pull requests and issues, comments,
reviews and commit checks/statuses using their documented REST endpoints. GitHub review threads use
GraphQL cursor pagination, including nested comment pages. GitLab supports discussions, notes and
pipelines. Azure issues are Work Items; creation depends on a process with the `Issue` type, and review
votes require the user's reviewer identity. Unsupported native review events produce an explicit error.

### Pull request workbench

The Pull Requests & Issues panel grants the selected provider origins before API access and resolves
the selected worker-held account. New pull requests use the current local branch; changing branches
while the dialog is open requires reopening the dialog. The returned creation URL remains visible after
list refreshes. A failed list refresh does not ask the user to repeat an already completed write.

`checkoutGitPullRequest` fetches the source repository and branch identified by `getPullRequest`, checks
the fetched tracking ref against the provider's source commit, then creates a new local branch with
`branch.<name>.remote` and `branch.<name>.merge`. GitLab resolves the MR's source project separately.
Forks on another origin require their own grant and matching account; the target token is never forwarded.
Existing local branches are never reset. Checkout respects dirty source buffers, cancellation, live
collaboration and workspace/HEAD changes. If checkout fails after branch creation, that named branch
remains available for recovery. Smart HTTP still needs the deployment's CORS or approved proxy setup.

Review comments remain text, including remote markup. Current new-side positions can be shown through
the host's `annotations` service with source `git-review`; other diagnostic sources remain independent.
The file must exactly match the checked-out PR head. Source edits, workspace replacement and HEAD changes
clear the contribution. Old-side, outdated, deleted, untracked and invalid file positions are not marked
on current source. Comments without current positions remain readable in the review list.

GitHub provides `diffSide`, `line` and `isOutdated`; GitLab discussion positions include `new_line` and
`head_sha`; Bitbucket inline positions use `to` and `outdated`. Azure threads request the latest
`$iteration` and verify its source commit and tracked iteration. Gitea's JSON `position` is its new-file
`LineNum`, while `original_position` is its old-file `OldLineNum`, as defined in the official
[API structs](https://github.com/go-gitea/gitea/blob/main/modules/structs/pull_review.go) and
[conversion implementation](https://github.com/go-gitea/gitea/blob/main/services/convert/pull_review.go).
Azure's [thread tracking contract](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-threads/list?view=azure-devops-rest-7.1)
and [iteration metadata](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iterations/list?view=azure-devops-rest-7.1)
define the corresponding current-file mapping. Hand-authored fixtures cover the provider schemas,
canonical pack fetch plus actual tracking config, created-link UI and annotation ownership. They are not
a claim of live-provider or native-browser qualification.

## REST Git snapshots and consistency

`createProviderTransport()` exposes `listRefs`, `readCommit`, `readTree`, `readBlob`, `readSnapshot`,
`createCommit`, `updateRef`, and `commitFiles`. Snapshot reads pin file requests to an immutable commit,
preserve binary bytes and apply file-count, tree-depth and total-byte bounds.

| Provider | Snapshot writes | Reference consistency |
| --- | --- | --- |
| GitHub | Git Data blobs, trees and commits | GraphQL `updateRefs` with `beforeOid`, no force |
| Azure DevOps | Git pushes with base64 file changes | `oldObjectId` compare-and-swap per reference |
| GitLab | Repository commit actions | Explicit `consistency:'file'`; per-file `last_commit_id`, no forced branch replacement |
| Gitea | Multi-file contents operation | Explicit `consistency:'file'`; per-file expected blob SHA, `force_push:false` |
| Bitbucket Cloud | Multipart source commit with immutable parent | Explicit `consistency:'non-atomic-parent'`; no atomic branch CAS claim |

The default strict write mode rejects GitLab/Gitea/Bitbucket operations that cannot provide a branch CAS.
Use smart HTTP for strict concurrent push semantics on these hosts. Azure rejects a request for a
multi-reference atomic transaction because its reference results can succeed independently. GitLab
supports regular and executable files; Azure/Gitea action writes currently accept regular files only.
Snapshot export of submodules is explicitly unsupported.

REST commit metadata does not preserve every original Git header, signature or timezone. These adapters
therefore report `canonicalObjects:false`; the generic canonical object transport must not synthesize
different commit bytes under a remote SHA. Snapshot commits report their actual server-generated IDs.

### Studio snapshot workflow

**Git Snapshot** opens a remote branch through provider RPC without attempting smart HTTP. Its metadata
notice explains that files are imported without the original Git history or signatures. Opening it uses
Studio's workspace-loading seam and its existing source records. Text keeps its detected encoding;
unchanged binary files keep their original bytes. Source files open in the normal editor, and **Refresh
Changes** compares those actual records with the immutable remote snapshot.

**Commit Snapshot** presents the destination branch and remote, requires a commit message, and submits
the exact opened head as the conflict guard. The default guarantee is strict branch comparison. Providers
with weaker APIs expose a separately labeled choice, including Bitbucket's possibility of losing concurrent
branch changes. A weaker commit requires a fresh snapshot before another write. A workspace switch or
an import that did not retain every original file disables snapshot commits. A failed remote comparison
leaves the baseline unchanged so an unsuccessful update cannot be presented as committed.

The PR/issue panel resolves accounts from credential metadata and active preferences, requests the remote
origin grant before its first provider request, and invokes authentication through the same sign-in action.
Comment and review dialogs retain the selected remote and operation; changing a subsequent list selection
cannot redirect an already opened write dialog to a different target.

## Export and worker integration

Use a session's `SecretRedactor` for diagnostic and workspace JSON values. Use `sanitizeGitExportFiles`
before ZIP or A26 publication, or `sanitizeGitExportZip` for an existing validated ZIP. ZIP sanitization
decompresses entries, scrubs text and rebuilds CRCs; it never edits compressed bytes in place. Binary
content containing a registered secret fails closed. Refreshed secrets remain registered until logout
so a delayed failure cannot expose a previous token.

`createGitAuthContext()` owns the vault, grants, lifecycle and redactor. `createAuthOperations(context)`
registers the global `git.auth`, `git.provider` and `git.snapshot` GitService descriptors. `git.auth` methods are
`setCredential`, `listCredentials`, `logout`, `grant`, `revokeGrant`, `configurePersistence`,
`describeGrants`, `inspectCredential` and `sanitizeArtifact`. `git.provider` accepts only its explicit PR/issue/comment/review/check allowlist. Neither
operation returns token values. The host owns disposal and keeps callback configuration out of export data.

`git.snapshot` accepts `operation:'capabilities'|'refs'|'read'|'commit'`, a provider, remote URL and optional
credential ID. Reads return metadata and `files:[{path,mode,oid,content:Uint8Array}]`; binary data remains
byte-exact and is checked for registered secrets before crossing the worker boundary. A commit input
contains `ref`, `expectedOid`, `message` and bounded file changes. Writes require the same request-local
`writeConsent:{remoteId,scope:'push',confirmed:true}` as a push and default to `consistency:'strict'`.
Only an explicit caller choice can select a provider's weaker consistency mode. The host imports a
snapshot as a separate action; this contract does not claim a canonical Git clone.

`sanitizeArtifact({name,mimeType,bytes:Uint8Array})` processes the actual download bytes through the
worker RPC and returns `{bytes,mimeType}`. It bounds both input and output to 64 MiB. ZIP input is
validated, decoded, sanitized and rebuilt with fresh CRCs; project/diagnostic JSON is parsed and scrubbed
by key and value; text is redacted. Binary secrets, including UTF-16 at either alignment, fail closed.
Canonical Git bundles remain byte-for-byte unchanged when accepted; this boundary never rewrites their
object identifiers or compressed payload. A26's separate publish implementation must use the same
artifact contribution boundary; fixture coverage does not assert deployment of an absent publish host.

## Verification and primary references

Focused `tests/a25-auth-*.test.js` files cover origin and token capture boundaries, encrypted storage,
PKCE state/replay, device polling/cancellation, broker secrecy, refresh/logout races, provider fixture
contracts, pagination/rate limits, binary snapshots, actual ZIP redaction and settings/CSP regeneration.
Most use injected Web APIs and hand-authored fixtures based on official schemas. The separate
`tests/a25-auth-github-recorded.test.js` replays selected public GitHub REST fields, an actual authorized
PR creation's normalized result, and captured normalized review-thread nodes. Its corpus at
`tests/fixtures/a25-providers/` records source identities, capture times, selected-field hashes and
omissions, and distinguishes captured data from authored HTTP/GraphQL replay envelopes.
Unauthorized local policy remains authored; no recorded remote denial or other-provider capture is
claimed. Artifact RPC fixtures use MessageChannel and the actual worker/service dispatch.
Run these tests as the completed A25 scope batch. Offline replay does not establish a browser/account
flow or raw transport behavior; recorded-fixture provenance does not require continuous live-account
CI, a provisioned OAuth broker, or a new provider account.

- [GitHub OAuth, device flow and S256 PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub App token refresh](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
- [GitHub Git references and GraphQL beforeOid](https://docs.github.com/en/graphql/reference/git)
- [GitHub REST pull requests](https://docs.github.com/en/rest/pulls/pulls)
- [GitHub OAuth scope response headers](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- [GitHub fine-grained credential types](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/github-credential-types)
- [GitLab current PAT self-inspection](https://docs.gitlab.com/api/personal_access_tokens/#self-inform)
- [GitLab repository trees and blobs](https://docs.gitlab.com/api/repositories/)
- [GitLab commit action conflict guards](https://docs.gitlab.com/api/commits/)
- [GitLab merge requests](https://docs.gitlab.com/api/merge_requests/)
- [Bitbucket Cloud source commits](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-source/)
- [Bitbucket Cloud pull requests](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/)
- [Bitbucket OAuth and API token scope distinctions](https://developer.atlassian.com/cloud/bitbucket/rest/intro/)
- [Microsoft Entra authentication for Azure DevOps](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth)
- [Azure DevOps scope definitions and inheritance](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth)
- [Azure PAT management requires Entra authentication](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate)
- [Azure DevOps push creation](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pushes/create?view=azure-devops-rest-7.1)
- [Gitea tree API](https://docs.gitea.com/api/operations/get-tree/)
- [Gitea multi-file contents commits](https://docs.gitea.com/api/operations/repo-change-files/)
- [Gitea token API authentication and permission levels](https://docs.gitea.com/development/api-usage/)
- [Gitea current-token self-inspection](https://docs.gitea.com/api/operations/get-current-token/)
- [PKCE RFC 7636](https://www.rfc-editor.org/rfc/rfc7636)
- [Device Authorization Grant RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)
