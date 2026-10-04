function element(document, name, text, className) {
  const node = document.createElement(name);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/** Bounded, keyboard-operable surfaces for rejected imports, external-change choices, and closed-file search. */
export class DiskServicesView {
  constructor(view, {choose, open}) {
    this.document = view.element.ownerDocument;
    this.choose = choose;
    this.open = open;
    this.root = element(this.document, 'section', undefined, 'explorer-disk-services');
    this.root.setAttribute('aria-label', 'Disk workspace notifications');
    this.status = element(this.document, 'p', '', 'explorer-caption');
    this.status.setAttribute('role', 'status');
    this.report = element(this.document, 'details');
    this.prompts = element(this.document, 'div');
    this.results = element(this.document, 'section');
    this.results.setAttribute('aria-label', 'Workspace path search results');
    this.results.hidden = true;
    this.root.append(this.status, this.report, this.prompts, this.results);
    view.tree.before(this.root);
    this.report.hidden = true;
    this.promptRows = new Map();
  }

  message(text) { this.status.textContent = text; }

  importReport(outcomes = []) {
    this.report.hidden = !outcomes.length;
    this.report.replaceChildren();
    if (!outcomes.length) return;
    const summary = element(this.document, 'summary', outcomes.length + ' skipped workspace paths');
    const list = element(this.document, 'ol');
    const more = element(this.document, 'button', 'Show more paths', 'button');
    more.type = 'button';
    let offset = 0;
    const append = () => {
      list.replaceChildren();
      const end = Math.min(offset + 100, outcomes.length);
      for (; offset < end; offset++) {
        const item = outcomes[offset];
        list.append(element(this.document, 'li', typeof item === 'string' ? item + ' — ignored folder'
          : item.path + ' — ' + (item.detail ?? item.reason)));
      }
      more.hidden = offset === outcomes.length;
    };
    more.addEventListener('click', append);
    this.report.append(summary, list, more);
    append();
  }

  prompt(value) {
    let row = this.promptRows.get(value.path);
    if (!row) {
      row = element(this.document, 'section', undefined, 'disk-change-prompt');
      row.setAttribute('aria-label', 'External change to ' + value.path);
      this.promptRows.set(value.path, row);
      this.prompts.append(row);
    }
    row.replaceChildren(element(this.document, 'p', value.path + (value.changedAgain
      ? ' changed on disk again. Your edits are still retained.' : ' changed on disk. Choose how to handle your unsaved edits.')));
    const actions = element(this.document, 'div', undefined, 'tool-actions');
    for (const [choice, label] of [['reload', 'Reload disk version'], ['keep', 'Keep my edits'], ['compare', 'Compare versions']]) {
      const button = element(this.document, 'button', label, 'button');
      button.type = 'button';
      button.dataset.diskChoice = choice;
      button.addEventListener('click', () => this.choose(value.path, choice));
      actions.append(button);
    }
    row.append(actions);
  }

  removePrompt(path) { this.promptRows.get(path)?.remove(); this.promptRows.delete(path); }

  compare(result) {
    const row = this.promptRows.get(result.path);
    if (!row) return;
    row.querySelector('.disk-change-comparison')?.remove();
    const comparison = element(this.document, 'div', undefined, 'disk-change-comparison');
    for (const [label, text] of [['Your current edits', result.localText], [result.deleted ? 'Deleted on disk' : 'Disk version', result.diskText]]) {
      const field = element(this.document, 'label', label, 'tool-field');
      const value = element(this.document, 'textarea');
      value.readOnly = true;
      value.value = text;
      value.rows = 8;
      field.append(value);
      comparison.append(field);
    }
    row.append(comparison);
  }

  paths(query, matches = [], {loading = false, truncated = false} = {}) {
    this.results.hidden = !query;
    this.results.replaceChildren();
    if (!query) return;
    this.results.append(element(this.document, 'p', loading ? 'Searching all workspace paths…'
      : matches.length + ' path matches' + (truncated ? ' · first 100 shown' : ''), 'explorer-caption'));
    const list = element(this.document, 'div', undefined, 'disk-path-results');
    for (const match of matches) {
      const button = element(this.document, 'button', match.path, 'search-result');
      button.type = 'button';
      button.addEventListener('click', () => this.open(match.path));
      list.append(button);
    }
    this.results.append(list);
  }

  reset() { this.message(''); this.importReport([]); this.prompts.replaceChildren(); this.promptRows.clear(); this.paths(''); }
  dispose() { this.root.remove(); this.promptRows.clear(); }
}
