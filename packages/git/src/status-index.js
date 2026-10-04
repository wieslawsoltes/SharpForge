/** Classify current index entries once per status request; entry flags remain mutable between requests. */
export function classifyStatusIndex(index) {
  const gitlinks = new Set();
  const special = [];
  const unmerged = [];
  for (const entry of index.entries) {
    if (entry.mode === 0o160000) gitlinks.add(entry.path);
    if (entry.stage !== 0) unmerged.push(entry);
    else if (entry.skipWorktree || entry.mode === 0o160000) special.push(entry);
  }
  return { gitlinks, special, unmerged };
}
