/** Present explicit save outcomes. Binary/missing baselines retain their available choices without inventing a text merge. */
export function promptWorkspaceSaveConflict({ask, query, escapeHtml}, conflict) {
  const {path, base, mine, theirs} = conflict;
  const textMerge = [base, mine, theirs].every(value => typeof value === 'string');
  const preview = value => typeof value === 'string' ? value.slice(0, 12000) : value === null
    ? '(File is absent)' : value instanceof Uint8Array ? `(Binary file: ${value.length} bytes)` : '(Baseline contents unavailable)';
  const panes = [['Your edits', mine], ['Current disk version', theirs]].map(([label, value]) =>
    `<label class="tool-field">${label}<textarea readonly rows="7">${escapeHtml(preview(value))}</textarea></label>`).join('');
  const content = `<p><strong>${escapeHtml(path)}</strong> changed on disk. Your current buffer is retained until you choose.</p>` +
    '<label class="tool-field">Resolution<select id="workspace-save-choice" aria-label="Save conflict resolution">' +
    '<option value="keep-mine">Keep mine and save over the observed disk version</option>' +
    '<option value="take-theirs">Take the disk version</option>' +
    `<option value="merge"${textMerge ? '' : ' disabled'}>Merge non-overlapping text changes</option></select></label>` +
    (textMerge ? '' : '<p>Text merge requires all three text versions. Select one complete version for binary or deleted files.</p>') + panes;
  return ask('Resolve Save Conflict', content, 'Apply Choice', () => query('#workspace-save-choice').value);
}
