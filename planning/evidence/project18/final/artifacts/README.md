# Original source and raw qualification artifacts

The [artifact manifest](../artifacts.json) is the exact output of the verified
packer. It records the identities of the complete original files. The separate
[storage manifest](../artifact-storage.json) maps those files to the actual Git
blobs in this evidence branch and records fetched-byte verification.

## Original integration source

Download [integration.bundle](integration.bundle), or obtain it by checking out
this evidence branch. It is one complete 3,353,040-byte file, with SHA-256:

```text
84bbf4b19b6bbbf0c0c9fa75317a2f198a0ae39cf487866146c858d741e12c05
```

The bundle advertises `refs/heads/codex/p18-integration` at the original canonical
commit `c68c77252cd5469c5aaf0c8318ee28fe2ec3b65d`, with tree
`55e5f5c443d15030bc47592e6ba511862812f363`. Its prerequisite is available from
pinned main `1db2e1d540a78403b7aaddcf472311fcde1a81ef` and its ancestors.
The parent report contains the exact restore commands. This original source
identity is distinct from the published aggregate commit whose tree is equal.

## Raw qualification archive

The original archive is 66,648,668 bytes. Its whole-file SHA-256 is:

```text
9c96eab7185bdedc2c4a99f61106e33c9b2335e4075cbe505eb422c386178dd5
```

The whole-file upload was rejected by the tool's IPC frame limit before GitHub
transmission: the encoded request was 88,865,242 bytes, above 67,108,864 bytes.
The archive is therefore stored as 16 consecutive parts in
`qualification-raw.tar.gz.parts/`. Parts 1 through 15 are 4,194,304 bytes each;
part 16 is 3,734,108 bytes. No part changes the compressed archive bytes.
The original complete archive Git blob identity in `artifacts.json` describes
the reassembled file; that whole blob is not a repository file.

Obtain the complete evidence branch with Git so all 16 part files are available.
From this `artifacts` directory, reconstruct in numeric order:

```sh
cat qualification-raw.tar.gz.parts/part-* > qualification-raw.tar.gz
sha256sum qualification-raw.tar.gz
```

The zero-padded part names make lexical order equal to the explicit manifest
order. Check that the result has the whole-file size and SHA-256 above before
extracting it. For a portable Python check and reconstruction, run:

```python
import hashlib
from pathlib import Path

parts = Path("qualification-raw.tar.gz.parts")
digest = hashlib.sha256()
total = 0
with Path("qualification-raw.tar.gz").open("xb") as target:
    for number in range(1, 17):
        with (parts / f"part-{number:06d}").open("rb") as source:
            while chunk := source.read(1024 * 1024):
                target.write(chunk)
                digest.update(chunk)
                total += len(chunk)
assert total == 66648668
assert digest.hexdigest() == "9c96eab7185bdedc2c4a99f61106e33c9b2335e4075cbe505eb422c386178dd5"
```

The packer verified every one of the archive's 1,321 members, including its
embedded frozen-input manifest. Raw failures, later corrections, benchmark
samples, browser traces, original runner versions and exact source references
remain included. The archive is evidence; it does not execute any proposed
Studio entry or change a working checkout.

## Archive locations

| Prefix | Contents |
| --- | --- |
| `qualification/final/` | The sealed raw qualification subtree, manifests, runner versions and source records. |
| `qualification/historical/` | Evidence already tracked in the canonical source tree. |
| `publication/` | Explicit current and historical publication receipts. |
| `assessment/publication-plan/` | The reviewed parent proof and reproduction driver sources. |
| `assessment/` | The upload plan, input refresh ledger and source/runner proof. |
| `protected/` | All 13 current protected review files, including historical patch versions. |
| `_manifest/` | Exact selected-file and complete frozen-input inventories. |

The final aggregate/ref and binary-upload readbacks were produced after packing
and are published directly beside this report. They are intentionally outside
the archive they describe.
