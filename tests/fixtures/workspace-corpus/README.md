# Workspace fidelity corpus

These authored fixtures exercise Project 18 workspace/archive fidelity. The manifest
records each file's SHA-256 and exact length, explicitly empty directories, selected
entry, and expected C# project membership. Fixtures retain their original bytes on
checkout, including CRLF, UTF-8 BOM, UTF-16 LE/BE with and without BOM, all byte values,
zero-length assets, deep directories and separate NFC/NFD names.

The cases cover an SLNX solution with explicit and XML-escaped membership, a classic
SLN solution using SDK default membership, and a plain folder. Empty directories are
materialized from the manifest because Git does not store empty directories.

Run the complete scope after implementation:

```sh
node --test tests/workspace-roundtrip.test.js
python tests/browser_explorer_corpus_test.py
```

The unit suite compares ZIP import/export and a real temporary native filesystem,
using the same public workspace APIs as the product. The browser suite separately
exercises Chromium with an OPFS-backed directory and the actual loopback native host.
It records the engine and operating system; an unavailable engine is never a pass.
The browser's selected local-folder picker and other operating systems require their
own qualification. Fixtures are original test data and contain no credentials.
