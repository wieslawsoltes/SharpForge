import { parseArgs } from 'node:util';
import { overlaps } from './lib/paths.js';
import { readJSON, isMain, report } from './lib/io.js';
export function primaryPaths(issue) {
  const paths = [];
  for (const line of (issue.body ?? '').split(/\r?\n/)) {
    const declaration = line.match(/^[ \t]*(?:\*\*)?(?:Owns|Write only):(?:\*\*)?[ \t]*(.*)$/);
    if (!declaration) continue;
    let remaining = declaration[1];
    // Only the leading code-path list belongs to this declaration. Later
    // workstream scope and shared-hot-file examples describe different rules.
    while (true) {
      const path = remaining.match(/^`([^`]+)`/);
      if (!path) break;
      paths.push(path[1]);
      remaining = remaining.slice(path[0].length);
      const separator = remaining.match(/^(?:[ \t]*,[ \t]*|[ \t]+)/);
      if (!separator) break;
      remaining = remaining.slice(separator[0].length);
    }
  }
  return paths;
}
export function declaredLocks(issue) { return issue.lockKeys ?? (issue.project?.['Lock keys'] ?? '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean); }
export function pathCollisions(issues, locks = {}) {
  const parents = new Set(issues.map(i => i.parent).filter(Boolean)), leaves = issues.filter(i => i.state === 'OPEN' && i.kind !== 'Epic' && !parents.has(i.id));
  const errors = [], serialized = [];
  for (let i = 0; i < leaves.length; i++) for (const b of leaves.slice(i + 1)) {
    const a = leaves[i];
    for (const p of a.paths ?? primaryPaths(a)) for (const q of b.paths ?? primaryPaths(b)) if (overlaps(p, q)) {
      const common = declaredLocks(a).filter(key => declaredLocks(b).includes(key) && locks[key]?.some(path => overlaps(p, path) && overlaps(q, path)));
      const message = `${a.id} (${p}) overlaps ${b.id} (${q})`;
      if (common.length) serialized.push({ tasks: [a.id, b.id], locks: common, paths: [p, q] }); else errors.push(message);
    }
  }
  return { errors, serialized };
}
if (isMain(import.meta.url)) { const { values } = parseArgs({ options: { snapshot: { type: 'string', default: 'planning/backlog.snapshot.json' } } }); report(pathCollisions(readJSON(values.snapshot).issues, readJSON('planning/contracts/locks.json'))); }
