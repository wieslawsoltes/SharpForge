import {element, field, input, select, checkbox} from '../ui.js';

function page(category, title, fields) {
  return {id: category + '.' + title.toLowerCase().replaceAll(' ', '-'), category, title,
    render(host, {draft, update}) {
      const document = host.ownerDocument;
      for (const definition of fields) {
        const [label, group, key, kind, choices] = definition;
        const value = draft[group][key];
        const changed = next => update(group, key, next);
        if (kind === 'boolean') host.append(checkbox(document, label, value, changed));
        else if (kind === 'select') host.append(field(document, label, select(document, label, choices, value, changed)));
        else host.append(field(document, label, input(document, label, value,
          next => changed(kind === 'number' ? Number(next) : next), {type: kind === 'number' ? 'number' : 'text'})));
      }
    }};
}

export function registerGeneralOptions(options) {
  const pages = [
    page('Environment', 'General', [
      ['Color theme', 'environment', 'theme', 'select', ['dark', 'light', 'blue', 'high-contrast', 'system']],
      ['Density', 'environment', 'density', 'select', ['compact', 'comfortable']],
      ['Environment font', 'environment', 'fontFamily', 'text'], ['Environment font size', 'environment', 'fontSize', 'number'],
      ['Show Start window', 'environment', 'showStartWindow', 'boolean'],
      ['Record workbench performance traces', 'environment', 'performanceTracing', 'boolean']
    ]),
    page('Projects and Solutions', 'General', [
      ['Default configuration', 'projects', 'configuration', 'select', ['Debug', 'Release']],
      ['Platform', 'projects', 'platform', 'text'], ['Auto-recover interval (seconds)', 'projects', 'autoRecoverSeconds', 'number']
    ]),
    page('Text Editor', 'General', [
      ['Font size', 'editor', 'fontSize', 'number'], ['Tab size', 'editor', 'tabSize', 'number'],
      ['Insert spaces', 'editor', 'insertSpaces', 'boolean'], ['Word wrap', 'editor', 'wordWrap', 'boolean'],
      ['Line numbers', 'editor', 'lineNumbers', 'boolean'], ['Zoom percent', 'editor', 'zoom', 'number'],
      ['Normalize line endings on save', 'editor', 'normalizeLineEndings', 'boolean'],
      ['Normalized line endings', 'editor', 'endOfLine', 'select',
        [{value: '\n', label: 'LF'}, {value: '\r\n', label: 'CRLF'}, {value: '\r', label: 'CR'}]]
    ]),
    page('Debugging', 'General', [
      ['Stop on entry', 'debugging', 'stopOnEntry', 'boolean'],
      ['Break on unhandled exceptions', 'debugging', 'breakOnUnhandled', 'boolean'],
      ['Record reversible history', 'debugging', 'recordHistory', 'boolean']
    ]),
    page('Designer', 'General', [
      ['Snap to grid', 'designer', 'snapToGrid', 'boolean'], ['Grid size', 'designer', 'gridSize', 'number']
    ]),
    page('Runtime', 'Sessions', [['Maximum concurrent app sessions', 'runtime', 'maxSessions', 'number']])
  ];
  pages.push({id: 'Environment.tasks', category: 'Environment', title: 'Task List', keywords: ['TODO', 'HACK', 'tokens'],
    render(host, {draft, update}) {
      host.append(element(host.ownerDocument, 'p', {text: 'One comment token per line: TOKEN:low, TOKEN:normal or TOKEN:high.'}));
      const area = element(host.ownerDocument, 'textarea', {'aria-label': 'Task List comment tokens', rows: 8});
      area.value = draft.tasks.tokens.map(item => item.token + ':' + item.priority).join('\n');
      area.addEventListener('input', () => update('tasks', 'tokens', area.value.split(/\r?\n/u).filter(Boolean).map(line => {
        const [token, priority = 'normal'] = line.split(':');
        return {token: token.trim(), priority: priority.trim()};
      })));
      host.append(area);
    }});
  return pages.map(definition => options.register(definition));
}
