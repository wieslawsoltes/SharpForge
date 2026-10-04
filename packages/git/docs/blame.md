# Line attribution

`blame(repository, path, options)` returns records ordered by their final line number. It reads immutable commit and blob objects and does not change HEAD, the index, or worktree files. Records retain `oid`, `path`, `originalLine`, `finalLine`, `text`, `author`, `committer`, `summary`, and `boundary`. Line numbers are one-based. `ignored` and `unblamable` are present when an ignored change was transferred to an earlier commit or could not be transferred.

Whole-file renames are followed automatically using the repository history matcher. Every merge parent is considered, unless `firstParent: true` is requested. A shallow commit is an attribution boundary: missing history behind it is not fetched. UTF-8 text is required; binary blobs and submodule entries produce `Unsupported`.

## Streaming results

```js
import { blameIncremental } from '@sharpforge/git';

for await (const chunk of blameIncremental(repository, 'src/parser.js', {
  revision: 'HEAD',
  detectMoves: true,
  signal
})) {
  displayAttribution(chunk.finalLine, chunk.lines);
}
```

Each chunk contains one contiguous group from the same source: `oid`, `path`, `originalLine`, `finalLine`, `lineCount`, metadata, and an immutable `lines` array. Groups are emitted as their attribution becomes final, usually with newer commits first. Consumers must use `finalLine` to place them; arrival order is not file order. An optional `onChunk(chunk)` callback is awaited before yielding, providing backpressure for viewers or RPC adapters.

`formatBlameIncremental(chunks, { signal })` converts such a stream to Git-style incremental text. It writes commit metadata once per commit, repeats each group's filename, quotes path bytes using Git's C-style conventions, and omits source line contents. Cancelled or prematurely closed iterators do not publish a partial result into the history cache.

## Options and Git equivalents

| Option | Behavior |
| --- | --- |
| `revision` | Commit-ish to inspect; defaults to `HEAD`. |
| `startLine`, `endLine` | Inclusive one-based range. Full immutable results are reused across viewer pages. |
| `ignoreWhitespace: true` | Ignores spaces, tabs, and carriage-return differences when matching lines, corresponding to `-w`. |
| `detectMoves: true` | Finds moved or duplicated blocks within the same file, corresponding to `-M`. |
| `moveThreshold` | Default 20. A block is accepted when one plus its ASCII alphanumeric byte count exceeds the threshold. |
| `detectCopies: true` | Implies move detection and searches other files modified in the same commit, corresponding to one `-C`. |
| `copyLevel: 2` | Additionally searches unchanged files when the target is created or renamed, corresponding to `-C -C`. |
| `copyLevel: 3` | Searches unchanged source files in each inspected parent, corresponding to `-C -C -C`. |
| `copyThreshold` | Default 40; the same alphanumeric scoring rule applies. |
| `ignoreRevs` | Array of commit-ish values whose changes should be reassigned where possible. |
| `ignoreRevsFile` or `ignoreRevsFiles` | One filename or an array of filenames, processed after `blame.ignoreRevsFile` configuration entries. |
| `readIgnoreRevsFile` | Optional explicit file reader, returning text, bytes, or `{ data }`. Without it, files are read through the safe repository worktree API. |
| `firstParent: true` | Follows only the first parent of each merge. |
| `showRoot: true` | Does not mark an actual root commit as a boundary. Shallow boundaries remain marked. |
| `diffAlgorithm` | `myers` by default; the existing `minimal` and `histogram` line-diff implementations are also accepted. |

`parseIgnoreRevs(text, { algorithm })` parses the full SHA-1 or SHA-256 object IDs used by ignore-revs files. Blank lines, comments beginning with `#`, and surrounding whitespace are accepted; abbreviated IDs are rejected. Repeated files are combined. An empty filename clears previously read file entries; explicitly supplied `ignoreRevs` remain active. Each resulting ID must resolve to a commit.

Ignored changes are processed after exact matching against all parents. Differing ranges use ordered byte-pair similarity with a ten-line search radius; unresolved lines use an indexed whole-file similarity search. Attribution keeps the `ignored` and `unblamable` markers rather than claiming that an unrelated addition has a known earlier source. Move and copy inspection then handles any remaining eligible blocks.

## Bounds and cache behavior

The default bounds are one million lines per file, 100,000 history traversals, 200 copy candidates per parent, 100,000 ignored revisions, and eight MiB per ignore-revs file. `maxLines`, `maxCommits`, `maxCopyCandidates`, `maxRevisions`, and `maxIgnoreFileBytes` can be supplied explicitly. Exhaustion raises `Limit`, rather than quietly disabling requested copy detection.

`maxWork` defaults to 20 million units shared by all line diffs, block scores, and similarity searches in one traversal. Myers matching retains the diff engine's bounded `O((N+M)D)` behavior. Fingerprint partitioning can require extra work for ambiguous repeated lines; the same cumulative bound stops pathological input. Copy candidates are read one at a time instead of retaining every candidate blob. A per-operation commit-date heap combines pending suspects without repeatedly sorting the entire queue.

The repository's weighted `GitHistory` cache owns completed attribution arrays. The cache key includes the resolved revision, path, comparison and copy options, resolved ignored revisions, rename options, and shallow boundaries. A changed ignore-revs file or newly deepened history therefore cannot reuse an incompatible result. Callbacks and selected viewer ranges do not create duplicate full-result cache entries.

## Reference qualification

`tests/a25-blame-native.test.js` defines 36 deterministic, local-only fixtures compared with `git blame --line-porcelain`. They include line insertion/deletion/replacement, final-newline changes, UTF-8 and CRLF text, `-w`, renamed files, moves and copies with score limits, all three copy search levels, ignored formatting/additions/split statements, consecutive ignored revisions, and merge parent selection. The suite records the native Git version and also compares reconstructed incremental results.

`tests/a25-blame-attribution.test.js` covers cancellation, iterator backpressure and early closure, cache publication, resource failures, malformed ignore files, SHA-256 repositories, and shallow boundaries. These fixtures are qualification definitions; passing or timing claims require the scheduled scope validation run.

Behavioral references: [Git blame documentation](https://git-scm.com/docs/git-blame), [Git blame implementation](https://github.com/git/git/blob/master/blame.c), and [fsck.skipList configuration](https://git-scm.com/docs/git-config#Documentation/git-config.txt-fsckskipList). The implementation reuses SharpForge's line-diff, object, repository, and history APIs.
