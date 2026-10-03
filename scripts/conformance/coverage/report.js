import {relative, resolve, sep} from 'node:path';

const count = value => Number.isSafeInteger(value) && value >= 0;
const percent = (covered, total) => total ? covered * 100 / total : null;
export function packageCoverage(summary, root) {
  if (!summary || !Array.isArray(summary.files)) throw new Error('Missing Node coverage summary');
  const packages = new Map(), seen = new Set();
  for (const file of summary.files) {
    const path = relative(resolve(root), resolve(file.path)).split(sep).join('/');
    if (!/^packages\/[^/]+\/src\/.+\.(?:[cm]?js|ts)$/.test(path)) continue;
    if (seen.has(path)) throw new Error('Duplicate coverage file: ' + path);
    seen.add(path);
    for (const kind of ['Line', 'Branch']) {
      if (!count(file['total' + kind + 'Count']) || !count(file['covered' + kind + 'Count'])
          || file['covered' + kind + 'Count'] > file['total' + kind + 'Count']) throw new Error('Invalid coverage counts: ' + path);
    }
    const name = path.split('/')[1], row = packages.get(name) ?? {package: name, files: [], lines: {covered: 0, total: 0}, branches: {covered: 0, total: 0}};
    row.files.push(path);
    row.lines.covered += file.coveredLineCount; row.lines.total += file.totalLineCount;
    row.branches.covered += file.coveredBranchCount; row.branches.total += file.totalBranchCount;
    packages.set(name, row);
  }
  return [...packages.values()].sort((a, b) => a.package.localeCompare(b.package)).map(row => ({...row,
    files: row.files.sort(), lines: {...row.lines, percent: percent(row.lines.covered, row.lines.total)},
    branches: {...row.branches, percent: percent(row.branches.covered, row.branches.total)}}));
}
export function checkFloors(areas, policy) {
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy.floors)) throw new Error('Invalid coverage floor policy');
  const errors = [], seen = new Set();
  for (const floor of policy.floors) {
    const key = floor.area + '/' + floor.package;
    if (!/^A\d\d$/.test(floor.area) || !/^[\w-]+$/.test(floor.package) || seen.has(key)
        || !/^[a-f0-9]{40}$/.test(floor.commit ?? '') || !floor.review
        || !Array.isArray(floor.files) || !floor.files.length || new Set(floor.files).size !== floor.files.length
        || floor.files.some(path => !path.startsWith(`packages/${floor.package}/src/`) || path.includes('..'))
        || floor.lines === null && floor.branches === null
        || !['lines', 'branches'].every(k => floor[k] === null || Number.isFinite(floor[k]) && floor[k] >= 0 && floor[k] <= 100)) {
      throw new Error('Invalid or unreviewed coverage floor: ' + key);
    }
    seen.add(key);
    const area = areas.find(row => row.area === floor.area);
    if (!area) continue; // A selected area does not claim to measure other areas.
    const actual = area.packages.find(row => row.package === floor.package);
    if (area.status !== 'passed' || !actual) { errors.push(key + ': no successful package measurement'); continue; }
    for (const path of floor.files) if (!actual.files.includes(path)) errors.push(key + ': previously measured file missing: ' + path);
    for (const kind of ['lines', 'branches']) if (floor[kind] !== null
        && (actual[kind].percent === null || actual[kind].percent + 1e-9 < floor[kind])) {
      errors.push(`${key}: ${kind} ${actual[kind].percent} below recorded floor ${floor[kind]}`);
    }
  }
  return errors;
}
export function floorProposal(report) {
  if (report.areas.some(row => !['passed', 'unsupported'].includes(row.status))) throw new Error('Cannot propose floors from a failed or incomplete run');
  if (!/^[a-f0-9]{40}$/.test(report.commit ?? '')) throw new Error('A proposal requires a source commit');
  return {schemaVersion: 1, status: 'proposal-needs-review', floors: report.areas.flatMap(area => area.packages.map(row => ({
    area: area.area, package: row.package, commit: report.commit, review: null,
    files: row.files, lines: row.lines.percent, branches: row.branches.percent,
  })))};
}
