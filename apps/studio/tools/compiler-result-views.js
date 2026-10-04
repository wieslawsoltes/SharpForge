import {disassemble} from '@sharpforge/bytecode';
import {disassembleAssembly} from '@sharpforge/cil';
import {sourcePanelVisible} from '../source-symbol-presentation.js';

const noFiles = Object.freeze([]);
const maximumCachedWords = 12_288;

function node(document, tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function text(element, value) {
  value = String(value);
  if (element.textContent !== value) element.textContent = value;
}

class BytecodeResultView {
  constructor(element, context) {
    this.element = element;
    this.context = context;
    this.options = [];
    this.methodLabels = [];
    this.methodIndices = new Map();
    this.instructionRows = new Map();
    this.codeSnapshot = null;
    this.pointSnapshot = [];
    this.onChange = event => {
      if (event.target === this.format) context.state.disassemblyFormat = event.target.value;
      else if (event.target === this.method) context.state.selectedMethod = Number(event.target.value);
      else return;
      this.render();
    };
    this.onClick = event => {
      const row = event.target.closest('[data-point]');
      if (!row || !element.contains(row)) return;
      const point = context.state.image?.sequencePoints[Number(row.dataset.point)];
      if (point) context.openFile(point.uri, point.start, point.end);
    };
    element.addEventListener('change', this.onChange);
    element.addEventListener('click', this.onClick);
  }

  empty(image) {
    const mode = image ? 'no-methods' : 'no-image';
    if (this.mode === mode) return;
    this.element.innerHTML = this.context.empty(image ? 'The assembly contains no methods' : 'No compiled assembly yet',
      'Build the solution to inspect actual CIL and the decoded VM instruction stream.', 'code');
    this.context.hydrate(this.element);
    this.mode = mode;
    this.options = [];
    this.methodLabels = [];
    this.methodIndices.clear();
    this.instructionRows.clear();
    this.codeSnapshot = null;
    this.pointSnapshot = [];
    this.image = null;
    this.currentRow = null;
    this.cilDump = null;
    this.cilMethods = null;
  }

  create() {
    const document = this.element.ownerDocument;
    const toolbar = node(document, 'div', 'panel-tools');
    this.format = node(document, 'select');
    this.format.id = 'bytecode-format';
    this.format.setAttribute('aria-label', 'Disassembly format');
    for (const [value, label] of [['cil', 'ECMA-335 CIL'], ['ir', 'Decoded VM IR']]) {
      const option = node(document, 'option', '', label);
      option.value = value;
      this.format.append(option);
    }
    const label = node(document, 'label', '', 'Method:');
    label.setAttribute('for', 'bytecode-method');
    this.method = node(document, 'select');
    this.method.id = 'bytecode-method';
    this.method.setAttribute('aria-label', 'Method');
    this.status = node(document, 'span');
    this.status.dataset.buildStatus = '';
    toolbar.append(this.format, label, this.method, node(document, 'span', 'panel-spacer'), this.status);
    const table = node(document, 'table', 'data-table code-dump');
    const header = node(document, 'thead');
    const heading = node(document, 'tr');
    this.headings = Array.from({length: 4}, () => node(document, 'th'));
    heading.append(...this.headings);
    header.append(heading);
    this.body = node(document, 'tbody');
    table.append(header, this.body);
    this.element.replaceChildren(toolbar, table);
    this.mode = 'assembly';
  }

  updateMethods(methods) {
    const unchanged = methods.length === this.methodLabels.length && methods.every((method, index) => {
      const previous = this.methodLabels[index];
      return method.id === previous.id && method.name === previous.name && method.qualifiedName === previous.qualifiedName;
    });
    if (unchanged) return;
    this.methodLabels = [];
    this.methodIndices = new Map();
    const document = this.element.ownerDocument;
    for (let index = 0; index < methods.length; index++) {
      const method = methods[index];
      this.methodIndices.set(method.id, index);
      this.methodLabels.push({id: method.id, name: method.name, qualifiedName: method.qualifiedName});
      let option = this.options[index];
      if (!option) {
        option = node(document, 'option');
        this.options.push(option);
        this.method.append(option);
      }
      if (option.value !== String(method.id)) option.value = String(method.id);
      text(option, method.qualifiedName);
    }
    while (this.options.length > methods.length) this.options.pop().remove();
  }

  instructions(selected, cil) {
    const state = this.context.state;
    if (!cil) return disassemble(state.image, selected.id)[0].instructions;
    state.ilDump ??= disassembleAssembly(state.assembly);
    if (this.cilDump !== state.ilDump) {
      this.cilDump = state.ilDump;
      this.cilMethods = new Map(state.ilDump.methods.map(method => [method.id, method]));
    }
    return this.cilMethods.get(selected.id)?.instructions ?? [];
  }

  unchangedInstructions(selected, image) {
    if (!this.codeSnapshot || selected.code.length !== this.codeSnapshot.length) return false;
    for (let index = 0; index < selected.code.length; index++) {
      if (selected.code[index] !== this.codeSnapshot[index]) return false;
    }
    for (const previous of this.pointSnapshot) {
      const point = image.sequencePoints[previous.index];
      if (!point || point.id !== previous.id || point.uri !== previous.uri || point.line !== previous.line) return false;
    }
    return true;
  }

  renderInstructions(selected, cil) {
    const state = this.context.state;
    const unchanged = this.image === state.image && this.assembly === state.assembly && this.selected === selected.id && this.cil === cil;
    if (!this.refreshRequested && unchanged && (cil || this.unchangedInstructions(selected, state.image))) return;
    const instructions = this.instructions(selected, cil);
    const headings = cil ? ['IL offset', 'Opcode', 'Operand / metadata symbol', 'Source'] : ['VM offset', 'Opcode', 'Operands', 'Source'];
    headings.forEach((heading, index) => text(this.headings[index], heading));
    const document = this.element.ownerDocument;
    const rows = [];
    this.instructionRows = new Map();
    this.codeSnapshot = !cil && selected.code.length <= maximumCachedWords ? selected.code.slice() : null;
    this.pointSnapshot = [];
    for (const instruction of instructions) {
      const row = node(document, 'tr');
      const point = instruction.point;
      row.dataset.offset = String(instruction.offset);
      if (point) row.dataset.point = String(point.id);
      if (point && this.codeSnapshot) {
        this.pointSnapshot.push({index: selected.code[instruction.offset * 3 + 1], id: point.id, uri: point.uri, line: point.line});
      }
      const offset = cil ? instruction.label : instruction.offset.toString(16).padStart(4, '0');
      const operands = cil ? instruction.operandText : `${instruction.a}, ${instruction.b}`;
      const location = point ? (cil ? 'SEQ ' : '') + point.uri + ':' + point.line : '';
      row.append(node(document, 'td', 'offset', offset), node(document, 'td', 'op', cil ? instruction.name : instruction.op),
        node(document, 'td', '', operands), node(document, 'td', 'point', location));
      rows.push(row);
      this.instructionRows.set(instruction.offset, row);
    }
    this.body.replaceChildren();
    for (const row of rows) this.body.append(row);
    this.image = state.image;
    this.assembly = state.assembly;
    this.selected = selected.id;
    this.cil = cil;
    this.currentRow = null;
    this.refreshRequested = false;
  }

  render() {
    const state = this.context.state;
    if (!state.image?.methods.length) return this.empty(state.image);
    if (this.mode !== 'assembly') this.create();
    this.updateMethods(state.image.methods);
    const selected = state.image.methods[this.methodIndices.get(Number(state.selectedMethod)) ?? 0];
    const cil = state.disassemblyFormat === 'cil';
    const format = cil ? 'cil' : 'ir';
    if (this.format.value !== format) this.format.value = format;
    if (this.method.value !== String(selected.id)) this.method.value = String(selected.id);
    text(this.status, state.buildDirty ? 'Last successful build' : this.context.formatBytes(state.assembly?.length ?? 0) + ' PE/CLI');
    this.renderInstructions(selected, cil);
    const frame = state.debug?.frames?.find(item => item.methodId === selected.id);
    const current = this.instructionRows.get(cil ? frame?.ilOffset : frame?.pc);
    if (current !== this.currentRow) {
      this.currentRow?.classList.remove('instruction-current');
      current?.classList.add('instruction-current');
      this.currentRow = current;
    }
  }

  refresh() {
    this.refreshRequested = true;
    // The public build result exposes mutable assembly bytes. Explicit activation must re-read them.
    this.context.state.ilDump = null;
  }

  dispose() {
    this.element.removeEventListener('change', this.onChange);
    this.element.removeEventListener('click', this.onClick);
    this.options = [];
    this.methodLabels = [];
    this.methodIndices.clear();
    this.instructionRows.clear();
    this.codeSnapshot = null;
    this.pointSnapshot = [];
    this.image = null;
    this.assembly = null;
    this.cilDump = null;
    this.cilMethods = null;
  }
}

class GeneratedResultView {
  constructor(element, context) {
    this.element = element;
    this.context = context;
    this.rows = [];
  }

  render() {
    const files = this.context.state.result?.generatedSources ?? noFiles;
    if (!files.length) {
      if (this.mode !== 'empty') {
        this.element.innerHTML = this.context.empty('No generated sources',
          'Enable a built-in generator in the Generators & Analyzers tool.');
        this.mode = 'empty';
        this.rows = [];
      }
      return;
    }
    const document = this.element.ownerDocument;
    if (this.mode !== 'files') {
      const toolbar = node(document, 'div', 'panel-tools');
      this.count = node(document, 'span');
      toolbar.append(node(document, 'b', '', 'Read-only compiler-generated sources'), node(document, 'span', 'panel-spacer'), this.count);
      this.element.replaceChildren(toolbar);
      this.mode = 'files';
    }
    text(this.count, files.length + ' files');
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      let row = this.rows[index];
      if (!row) {
        const details = node(document, 'details');
        details.open = true;
        row = {details, summary: node(document, 'summary'), source: node(document, 'pre', 'tool-source')};
        details.append(row.summary, row.source);
        this.rows.push(row);
        this.element.append(details);
      }
      if (row.uri !== file.uri) {
        row.details.open = true;
        row.summary.textContent = file.uri;
        row.uri = file.uri;
      }
      if (row.text !== file.text) {
        row.source.textContent = file.text;
        row.text = file.text;
      }
    }
    while (this.rows.length > files.length) this.rows.pop().details.remove();
  }

  dispose() {
    this.rows = [];
  }
}

/** The mount owns observation. Hidden notifications retain current state without building a result DOM or disassembly. */
class DeferredResultTool {
  constructor(element, context, View) {
    this.element = element;
    this.context = context;
    this.View = View;
    this.view = null;
    this.disposed = false;
    this.unsubscribe = context.docking.layout.subscribe(() => this.render());
  }

  render() {
    if (this.disposed) return;
    const document = this.element.ownerDocument;
    if (document !== this.document) {
      this.observer?.disconnect();
      const Observer = document.defaultView?.ResizeObserver;
      this.observer = Observer ? new Observer(() => this.render()) : null;
      this.observer?.observe(this.element);
      this.document = document;
    }
    if (!sourcePanelVisible(this.element)) return;
    this.view ??= new this.View(this.element, this.context);
    if (this.refreshRequested) {
      this.view.refresh?.();
      this.refreshRequested = false;
    }
    this.view.render();
  }

  refresh() {
    if (!this.disposed) this.refreshRequested = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.observer?.disconnect();
    this.view?.dispose();
    this.view = null;
  }
}

const resultViews = new Map([['bytecode', BytecodeResultView], ['generated', GeneratedResultView]]);

/** Register the two owned result views through the existing per-mount tool lifecycle. Other tools retain their renderer. */
export function registerCompilerResultTools(registry, definitions, context, renderOther) {
  const mounted = new Map();
  for (const {id, title} of definitions) {
    const View = resultViews.get(id);
    if (!View) {
      registry.registerTool(id, title, element => renderOther(id, element));
      continue;
    }
    const instances = new Set();
    mounted.set(id, instances);
    registry.registerTool(id, title, (element, {state}) => {
      if (!state.presentation) {
        state.presentation = new DeferredResultTool(element, context, View);
        instances.add(state.presentation);
      }
      state.presentation.render();
    }, (element, {state}) => {
      instances.delete(state.presentation);
      state.presentation?.dispose();
    });
  }
  return {refresh(id) { for (const instance of mounted.get(id) ?? noFiles) instance.refresh(); }};
}
