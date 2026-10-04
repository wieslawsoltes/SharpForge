import { gitElement, gitButton, gitField, gitEmpty } from './git-dom.js';

/** Locate complete marker blocks by offsets so accepting one conflict preserves every other edit. */
export function parseConflictBlocks(text) {
  const lines = [...text.matchAll(/[^\n]*\n|[^\n]+$/g)];
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const value = line[0];
    if (/^<{7,128} /u.test(value)) {
      current = { start: line.index, oursStart: line.index + value.length, oursEnd: null, theirsStart: null };
    } else if (current && /^\|{7,128} /u.test(value) && current.theirsStart === null) {
      current.oursEnd ??= line.index;
    } else if (current && /^={7,128}\r?\n?$/u.test(value)) {
      current.oursEnd ??= line.index;
      current.theirsStart = line.index + value.length;
    } else if (current && current.theirsStart !== null && /^>{7,128} /u.test(value)) {
      blocks.push({ start: current.start, end: line.index + value.length,
        ours: text.slice(current.oursStart, current.oursEnd), theirs: text.slice(current.theirsStart, line.index) });
      current = null;
    }
  }
  return blocks;
}

/** Resolve text, binary, deletion and mode conflicts only after an explicit result is accepted. */
export async function renderGitMerge(element, workbench, options = {}) {
  const path = workbench.selection?.path;
  if (!path) return gitEmpty(element, 'Resolve conflicts', 'Choose a conflicted file in Git Changes.');
  if (!workbench.changes.some(change => change.path === path && change.conflict)) {
    return gitEmpty(element, 'No unresolved conflict', 'Choose a conflicted file in Git Changes.');
  }
  const controller = options.controller ?? new AbortController();
  const conflict = await workbench.request('conflictDetail', { path }, { signal: controller.signal });
  controller.signal.throwIfAborted();
  if (options.isCurrent && !options.isCurrent()) return () => controller.abort();
  const document = element.ownerDocument;
  const textual = [conflict.base, conflict.ours, conflict.theirs].every(source => !source.exists || source.text !== null);
  const status = gitElement(document, 'p', { className: 'git-muted', role: 'status' });
  const conflicts = gitElement(document, 'div', { className: 'git-conflict-actions', 'aria-label': 'Unresolved text conflicts' });
  const result = textual ? gitElement(document, 'textarea', { className: 'git-merge-result', rows: 12,
    'aria-label': 'Resolved content', value: conflict.working.text ?? conflict.ours.text ?? conflict.theirs.text ?? '' }) : null;
  let choice = textual ? 'edited' : null;
  const context = { document, result, conflicts, status, onEdit: () => { choice = 'edited'; update(); } };
  const accept = side => {
    choice = side;
    if (result) result.value = conflict[side].text ?? '';
    update();
  };
  const resolve = gitButton(document, 'Mark Resolved', () => workbench.safe(() => workbench.run(async options => {
    if (!choice) throw new Error('Choose the complete current or incoming side, or delete the file.');
    await workbench.synchronize(options);
    const resolved = await workbench.request('resolveConflictChoice', {
      path, choice, stagesKey: conflict.stagesKey, workingOid: conflict.working.oid, text: choice === 'edited' ? result.value : undefined
    }, options);
    await workbench.applyResolvedFile(resolved, options);
    workbench.host.showPanel('git-changes');
  }, { workspace: true })), { className: 'git-primary' });
  const toolbar = gitElement(document, 'div', { className: 'git-toolbar' }, gitElement(document, 'strong', { text: path }),
    gitButton(document, 'Accept Current', () => accept('ours')),
    gitButton(document, 'Accept Incoming', () => accept('theirs')),
    gitButton(document, 'Delete File', () => { choice = 'delete'; update(); }), resolve);
  if (textual && conflict.ours.exists && conflict.theirs.exists) toolbar.insertBefore(gitButton(document, 'Accept Both', () => {
    result.value = conflict.ours.text + conflict.theirs.text;
    choice = 'edited';
    update();
  }), resolve);
  const sources = gitElement(document, 'div', { className: 'git-merge-sources' },
    ...[['Base', conflict.base], ['Current', conflict.ours], ['Incoming', conflict.theirs]].map(([label, source]) =>
      gitElement(document, 'section', {}, gitElement(document, 'h3', { text: label }), sourceView(document, source))));
  function update() {
    if (result) result.disabled = choice === 'delete' || choice === 'ours' && !conflict.ours.exists || choice === 'theirs' && !conflict.theirs.exists;
    const deleted = choice === 'delete' || choice === 'ours' && !conflict.ours.exists || choice === 'theirs' && !conflict.theirs.exists;
    status.textContent = deleted ? 'The resolution deletes this tracked file.' : choice === 'ours' ? 'The complete current version is selected.'
      : choice === 'theirs' ? 'The complete incoming version is selected.' : textual ? 'Edit the result or accept individual conflicts.'
        : 'Choose a complete side to preserve its exact bytes and file mode.';
    resolve.disabled = !choice;
    if (result && !deleted) drawConflictActions(context);
    else conflicts.replaceChildren();
  }
  if (result) result.addEventListener('input', context.onEdit);
  element.replaceChildren(toolbar, status, sources, conflicts,
    result ? gitField(document, 'Result', result) : gitElement(document, 'p', { className: 'git-muted',
      text: 'Binary files and files larger than the text editor limit are resolved as complete versions.' }));
  update();
  return () => controller.abort();
}

function sourceView(document, source) {
  if (!source.exists) return gitElement(document, 'p', { className: 'git-muted', text: 'Deleted or absent' });
  const label = `${source.size} bytes · mode ${source.mode.toString(8)} · ${source.oid?.slice(0, 8) ?? 'worktree'}`;
  if (source.text === null) return gitElement(document, 'p', {
    className: 'git-muted', text: `${source.binary ? 'Binary content' : 'Large text file'} · ${label}`
  });
  return gitElement(document, 'div', { className: 'git-merge-source' }, gitElement(document, 'p', { className: 'git-muted', text: label }),
    gitElement(document, 'pre', { text: source.text }));
}

function drawConflictActions({ document, result, conflicts, onEdit }) {
  const snapshot = result.value;
  const blocks = parseConflictBlocks(snapshot);
  conflicts.replaceChildren();
  if (!blocks.length) return;
  conflicts.append(gitElement(document, 'p', { className: 'git-muted', text: `${blocks.length} unresolved text conflicts` }));
  for (const [index, block] of blocks.slice(0, 100).entries()) {
    const accept = side => {
      if (result.value !== snapshot) return onEdit();
      result.value = snapshot.slice(0, block.start) + (side === 'both' ? block.ours + block.theirs : block[side]) + snapshot.slice(block.end);
      onEdit();
      result.focus();
      result.setSelectionRange(block.start, block.start);
    };
    conflicts.append(gitElement(document, 'div', { className: 'git-toolbar' },
      gitElement(document, 'span', { text: `Conflict ${index + 1}` }),
      gitButton(document, `Accept Current for Conflict ${index + 1}`, () => accept('ours')),
      gitButton(document, `Accept Incoming for Conflict ${index + 1}`, () => accept('theirs')),
      gitButton(document, `Accept Both for Conflict ${index + 1}`, () => accept('both'))));
  }
  if (blocks.length > 100) conflicts.append(gitElement(document, 'p', { className: 'git-muted',
    text: 'The first 100 conflicts are shown. Resolving them reveals the next group.' }));
}
