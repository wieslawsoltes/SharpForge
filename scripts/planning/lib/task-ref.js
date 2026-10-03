const ID = 'SF-(?:A\\d{2}|R\\d{3})-[TB]\\d{2}(?:\\.\\d+)?';
export function resolveTask({ branch, body = '', projectBranch }) {
  const branchId = branch?.match(new RegExp(`^(?:agent|agent-implementation|codex)/(${ID})(?:-|$)`))?.[1];
  const lines = [...body.matchAll(new RegExp(`^Task:\\s*(${ID})\\s*$`, 'gm'))].map(m => m[1]);
  if (new Set(lines).size > 1) throw new Error('PR has conflicting Task lines');
  const bodyId = lines[0];
  if (branchId && bodyId && branchId !== bodyId) throw new Error(`Task mismatch: branch=${branchId}, body=${bodyId}`);
  const task = branchId ?? bodyId; if (!task) throw new Error('PR has no resolvable Task: SF-Axx-Tnn identity');
  if (projectBranch !== undefined && projectBranch !== branch) throw new Error(`Project Branch ${projectBranch} does not match ${branch}`);
  return task;
}
