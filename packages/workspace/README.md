# @sharpforge/workspace

Versioned documents, syntax/result caching and stale-change rejection.

Version 0.9.0 · MIT · ES modules.

This package is part of SharpForge, an executable C# subset toolchain. It is not full C#/CLR/Visual Studio conformance. The source release includes architecture, API examples, compatibility boundaries and tests.

```js
import * as api from '@sharpforge/workspace';
```

Install its declared sibling packages together. npm publication is not part of this release. See the root project README and docs/embedding.md for integration.

## Filesystem and large workspaces

The package also exports byte-oriented memory, File System Access, OPFS worker, native-host, and dirty-buffer overlay providers; bounded watching and external-change decisions; lazy document admission; and incremental path/content search. See [FILESYSTEM.md](./FILESYSTEM.md) for provider contracts, examples, platform boundaries, and validation commands.
