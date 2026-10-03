import {SourceText} from '@sharpforge/text';

/** Designer diagnostics participate in the Error List without changing compiler success or build outputs. */
export function renderDesignerProblems(context, panel) {
  const {state, openFile, setPanel, nativeBuild, toast} = context;
  const diagnostics = [...state.result?.diagnostics ?? [], ...state.designerDiagnostics ?? []];
  const document = panel.ownerDocument;
  panel.replaceChildren();
  const toolbar = document.createElement('div');
  toolbar.className = 'panel-tools';
  const errors = diagnostics.filter(item => item.severity === 'error').length;
  const warnings = diagnostics.filter(item => item.severity === 'warning').length;
  toolbar.textContent = `${errors} errors · ${warnings} warnings · Build and designer`;
  panel.append(toolbar);
  if (!diagnostics.length) {
    const message = document.createElement('p');
    message.textContent = 'No diagnostics in the current build or designer documents.';
    panel.append(message);
    return;
  }
  const table = document.createElement('table');
  table.className = 'data-table';
  const head = document.createElement('thead');
  const header = document.createElement('tr');
  for (const label of ['Severity', 'Source', 'Code', 'Description', 'File', 'Line']) {
    const cell = document.createElement('th');
    cell.textContent = label;
    header.append(cell);
  }
  head.append(header);
  table.append(head);
  const body = document.createElement('tbody');
  for (const [index, diagnostic] of diagnostics.entries()) {
    const row = document.createElement('tr');
    row.dataset.diagnostic = String(index);
    row.dataset.severity = diagnostic.severity ?? 'info';
    row.tabIndex = 0;
    const file = state.files.find(file => file.uri === diagnostic.uri);
    const offset = diagnostic.start ?? diagnostic.span?.start ?? 0;
    const position = diagnostic.range?.start ?? (file ? new SourceText(file.text, file.uri).positionAt(offset) : {line: 0, character: 0});
    for (const value of [diagnostic.severity ?? 'info', diagnostic.source ?? 'Compiler', diagnostic.code,
      diagnostic.message, diagnostic.uri ?? '', position.line + 1]) {
      const cell = document.createElement('td');
      cell.textContent = String(value ?? '');
      row.append(cell);
    }
    const navigate = () => {
      if (state.nativeMode && diagnostic.uri) {
        nativeBuild.open(diagnostic.uri, position.line + 1, position.character + 1).catch(error => toast(error.message, 'error'));
      } else if (file) openFile(diagnostic.uri, offset, offset + (diagnostic.length ?? 0));
      else setPanel('project');
    };
    row.onclick = navigate;
    row.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(); }
    };
    body.append(row);
  }
  table.append(body);
  panel.append(table);
}
