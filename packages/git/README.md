# @sharpforge/git

Published Git modules for SharpForge. Each stacked layer exposes only its implemented dependencies.

## Revision graph and history

`CommitGraph` traverses bounded commit ancestry and shallow boundaries, computes merge bases and ancestor relationships, and accepts an explicit object database. `GitHistory` owns bounded immutable history caches; `revParse` resolves revision expressions through the supplied repository. Repository composition and its native integration fixtures enter a later layer.

## Line attribution

`blame(repository, path, options)` returns line records with commit identity, original and final line numbers and text. `blameIncremental` emits completed contiguous attribution chunks with cancellation and awaited callbacks. Move/copy thresholds and ignored revisions share a bounded work budget; shallow commits stop ancestry traversal. The APIs use the supplied repository/history contract; repository integration fixtures follow that facade.

## Origin, permission and secret boundaries

`GitOriginGrants` stores explicit remote-origin grants; network access and credential recipients are checked separately. `GitPermissions` distinguishes known scopes from unknown evidence and requires operation-specific consent for writes. A one-attempt unknown-scope consent does not override known-insufficient permissions. `SecretRedactor` removes registered secrets from diagnostics and exported artifacts. These contracts accept injected dependencies and do not provision provider accounts or permit implicit cross-origin redirects.
