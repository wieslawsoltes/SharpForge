# @sharpforge/git

Published Git modules for SharpForge. Each stacked layer exposes only its implemented dependencies.

## Revision graph and history

`CommitGraph` traverses bounded commit ancestry and shallow boundaries, computes merge bases and ancestor relationships, and accepts an explicit object database. `GitHistory` owns bounded immutable history caches; `revParse` resolves revision expressions through the supplied repository. Repository composition and its native integration fixtures enter a later layer.
