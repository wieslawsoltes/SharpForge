import {DISPLAY_LIST_VERSION, DrawOp, DrawingError, drawOpNames, rectangle, finite} from './commands.js';
import {validateCommand, snapshotDrawing, serializeDrawingValue} from './validation.js';

const pushes = new Set([DrawOp.PushTransform, DrawOp.PushClip, DrawOp.PushOpacity]);

/** Immutable data snapshot. Identity/version lets retained tree builders skip unchanged element encoding. */
export class DisplayList {
  constructor(commands, {elementId = '', version = 0, bounds = null, maxCommands = 1000000} = {}) {
    if (!Number.isInteger(maxCommands) || maxCommands < 1 || maxCommands > 10000000) throw new DrawingError('SFRENDER008', 'Invalid command budget');
    if (!Array.isArray(commands) || commands.length > maxCommands) throw new DrawingError('SFRENDER008', 'Invalid display-list size');
    let depth = 0;
    this.commands = commands.map((command, index) => {
      if (!command || !drawOpNames[command.op]) throw new DrawingError('SFRENDER012', 'Unknown drawing opcode', index);
      if (pushes.has(command.op) && ++depth > 256) throw new DrawingError('SFRENDER009', 'Drawing stack budget exceeded', index);
      if (command.op === DrawOp.Pop && --depth < 0) throw new DrawingError('SFRENDER010', 'Drawing stack underflow', index);
      return snapshotDrawing(validateCommand(command));
    });
    if (depth) throw new DrawingError('SFRENDER011', 'Unbalanced display list');
    this.format = DISPLAY_LIST_VERSION;
    this.elementId = String(elementId);
    this.version = finite(version, 'display-list version', 0, Number.MAX_SAFE_INTEGER);
    if (!Number.isInteger(version)) throw new DrawingError('SFRENDER015', 'Display-list version must be an integer');
    this.bounds = bounds && Object.freeze(rectangle(bounds));
    Object.freeze(this.commands);
    Object.freeze(this);
  }

  /** JSON serialization is deterministic; binary form is its UTF-8 envelope with a format discriminator. */
  serialize({binary = false} = {}) {
    const json = JSON.stringify({format: this.format, elementId: this.elementId, version: this.version,
      bounds: this.bounds, commands: this.commands}, serializeDrawingValue);
    return binary ? new TextEncoder().encode(json) : json;
  }

  /** Wire envelope for structured scene messages; opaque platform resources must use session resource handles. */
  toData() {
    return JSON.parse(this.serialize());
  }

  /** Accept the exact versioned data envelope or its UTF-8/JSON encoding, never executable objects. */
  static from(source, options = {}) {
    if (source instanceof DisplayList) return source;
    if (typeof source === 'string' || ArrayBuffer.isView(source) || source instanceof ArrayBuffer) return DisplayList.deserialize(source, options);
    if (source?.format !== DISPLAY_LIST_VERSION) throw new DrawingError('SFRENDER015', 'Unsupported display-list version');
    const serialized = JSON.stringify(snapshotDrawing(source), serializeDrawingValue);
    return DisplayList.deserialize(serialized, options);
  }

  static deserialize(source, {maxBytes = 64 * 1024 * 1024, maxCommands = 1000000} = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 * 1024) throw new DrawingError('SFRENDER013', 'Invalid byte budget');
    if (typeof source !== 'string' && source?.byteLength > maxBytes) throw new DrawingError('SFRENDER013', 'Display-list byte budget exceeded');
    let text;
    try { text = typeof source === 'string' ? source : new TextDecoder('utf-8', {fatal: true}).decode(source); }
    catch { throw new DrawingError('SFRENDER014', 'Malformed display-list UTF-8'); }
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new DrawingError('SFRENDER013', 'Display-list byte budget exceeded');
    let value;
    try { value = JSON.parse(text); } catch { throw new DrawingError('SFRENDER014', 'Malformed display-list JSON'); }
    if (value?.format !== DISPLAY_LIST_VERSION) throw new DrawingError('SFRENDER015', 'Unsupported display-list version');
    return new DisplayList(value.commands, {...value, maxCommands});
  }

  replay(adapter, resources, options = {}) { return adapter.render(this, resources, options); }
}

/** O(n) retained-element diff; content versions are supplied by the owning invalidation system. */
export function diffDisplayLists(previous, current) {
  const before = new Map((previous ?? []).map(list => [list.elementId, list]));
  const changed = [], retained = [], removed = [];
  for (const list of current) {
    const old = before.get(list.elementId);
    (old && old.version === list.version ? retained : changed).push(list);
    before.delete(list.elementId);
  }
  for (const list of before.values()) removed.push(list);
  return {changed, retained, removed};
}
