# Security policy

Report suspected vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/wieslawsoltes/SharpForge/security/advisories/new).
Do not put exploit details, credentials, private source or sensitive artifacts in a public issue or pull request.
If GitHub does not offer a private report form, do not substitute a public disclosure containing those details.

Include the affected commit or release/artifact digest, entry point (browser, standalone, CLI, native host or extension),
OS/browser/engine versions, a minimal reproduction, expected and observed behavior, impact, and relevant logs with secrets
removed. State any origin grants, native-project trust or other non-default configuration needed. Use only systems and data
you are authorized to test; avoid destructive reproduction steps and requests involving another user's data.

Maintainers can coordinate reproduction, remediation and disclosure within the private advisory. This project does not
publish a guaranteed response/fix deadline or a supported-version maintenance schedule. Supplying a report does not imply
that an affected engine, release or deployment is security-qualified.

Read the [threat model](planning/qualification/threat-model.md) and [operational security limits](docs/security.md).
Managed execution has logical limits, not an audited process sandbox. Native MSBuild projects/dependencies and registered
JavaScript extensions execute with host authority and require explicit trust. Networking is denied until the embedding
host grants exact origins; a grant allows access to that origin and does not replace browser or operating-system policy.
