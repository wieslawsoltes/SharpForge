# Recorded provider data

`github-recorded.json` contains selected public GitHub response fields captured on
2026-10-04 through the GitHub connector. The deterministic replay is in
`tests/a25-auth-github-recorded.test.js`; it never contacts a provider.

## Sources and representations

| Record | Actual source | Retained representation |
| --- | --- | --- |
| Creation | The publishing agent's already-authorized `create_pull_request` for [SharpForge #3635](https://github.com/wieslawsoltes/SharpForge/pull/3635) | Selected request fields and normalized connector result |
| Pull request | Public `GET /repos/wieslawsoltes/SharpForge/pulls/3635` immediately after creation | Selected REST JSON fields, including branch names and commit IDs |
| Issue | Public `GET /repos/wieslawsoltes/SharpForge/issues/2150` | Selected issue identity, title, state and URL |
| Review threads | Read-only `list_pull_request_review_threads` for [nodejs/node #62530](https://github.com/nodejs/node/pull/62530) | One of 12 normalized threads, with one of its three comments |
| Empty review threads | Read-only `list_pull_request_review_threads` for [SharpForge #3628](https://github.com/wieslawsoltes/SharpForge/pull/3628) | The actual empty normalized collection |

The publishing agent retained the creation result during ordinary stack
publication. The fixture author only issued read requests. No extra PR, issue,
review, comment, or unauthorized mutation probe was sent for this corpus.

Each record identifies its tool, public resource, capture time, representation,
selected fields and omissions. SHA-256 and byte length cover `JSON.stringify` of
the retained request/response object in its stored property order, encoded as
UTF-8. These fingerprints identify the retained selections; they are not hashes
of raw HTTP bytes or proof of an original full response. Tokens, authorization
headers, cookies and user profile/contact fields are not retained.

## What the replay authors

The creation result is a real normalized result from the authorized creation.
Its PR number, URL, title, branches and commit IDs match the later REST read.
The test replays the captured branch request through `createPullRequest` and uses
the captured GET body as its REST response model. Its HTTP `201` envelope is
authored because the connector did not expose the creation's transport status or
headers. It is not presented as a raw recorded POST response.

The review-thread connector returns snake-case normalized nodes. The replay
explicitly maps their fields to GraphQL names and adds single-page connection and
comment `pageInfo` envelopes. Those envelopes and cursor values are authored, and
the selected thread/comment subset is disclosed. Existing hand-authored fixtures
continue to exercise actual pagination logic, limits and errors.

The single-issue record is placed in an authored collection envelope. All replay
HTTP statuses, content-type headers, credentials, scopes and confirmation policy
are authored fixture inputs. The known-insufficient denial test uses the captured
creation input but tests local policy: it records no denied remote write and
makes no claim about the capture account's token scopes or repository roles.

## Remaining provenance boundary

This corpus adds actual GitHub creation, REST-record and review-node provenance.
It does not supply a recorded unauthorized write/token-scope denial, raw GraphQL
pagination responses, or any GitLab, Bitbucket, Azure DevOps or Gitea capture.
The remaining recorded-fixture acceptance and target-engine validation must be
tracked separately; neither a passing replay nor this capture metadata closes
an entire issue automatically.

The available GitHub connector only supports GitHub resources. Read-only public
GitLab and Bitbucket API retrievals through the public lookup tool were attempted
on 2026-10-04 but yielded tool access errors and no response body. That is a capture
capability limit of this session, not evidence that those providers require a new
account, a broker, continuous live-account CI, or a newly provisioned server.
