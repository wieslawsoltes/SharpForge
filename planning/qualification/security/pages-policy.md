# GitHub Pages policy — SF-A29-B03

`scripts/build.js` installs the generated network CSP immediately inside the
`head` of both `dist/index.html` and `dist/404.html`, before styles or scripts.
GitHub Pages ignores the accompanying `_headers` file. The metadata therefore
enforces the directives that support meta delivery even when no custom response
headers are available.

After every successful Pages deployment, the `deployed-policy` job takes the
actual `actions/deploy-pages` output URL and probes its `index.html` and `404.html`
sequentially. Each request has a 10-second deadline and a 32 MiB body limit; the
job has a two-minute deadline. An unsuccessful response, non-HTML content, absent
or different policy, late or inactive metadata, timeout or oversized body fails
the job. Direct `404.html` requests must return HTTP success: this checks the
published fallback document, not a nonexistent URL returning status 404.

The `deployed-pages-policy` artifact retains JSON results on success or failure,
including requested and final response URLs, policy delivery mode, individual
errors, bounds, observation time and workflow revision. The revision identifies
the workflow/build being deployed; it is not independent proof of the remote
server's revision. A failed policy probe does not roll back a completed deploy.

The regression suite `tests/conformance/security/pages-policy.test.js` is owned
by A29 through `tests/manifests/A29.json`'s conformance glob. Its HTTP fixture
serves an `_headers` file without applying it, reproducing the original defect,
then passes only after installing metadata in both documents. It also checks
one-file failures, HTTP errors, timeout/body limits, subpaths and retained CLI
failure evidence. These fixture results are not live deployment qualification.

`frame-ancestors` cannot be enforced through CSP metadata and is intentionally
omitted from the meta policy. Preventing framing requires an HTTP CSP header from
a host or reverse proxy that supports custom response headers. The `_headers`
file's `X-Content-Type-Options: nosniff` is likewise not activated by GitHub Pages;
this probe does not claim that header or a response `Referrer-Policy` is present.

Actual compile/run/debug browser qualification remains an explicit manual Pages
dispatch with `qualify: true`. It follows a passing policy probe and runs one
browser engine at a time (`max-parallel: 1`). Passing this lightweight policy
probe alone does not qualify those workflows or browser enforcement behavior.
