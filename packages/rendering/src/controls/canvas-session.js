import {DrawingContext} from '../drawing/context.js';
import {snapshotDrawing} from '../drawing/validation.js';

/** A managed Draw callback retains this exact recorder, including its sealed state across VM rewind. */
export class CanvasDrawingSession extends DrawingContext {
  constructor(options) {
    super(options);
    this.renderType = 'Microsoft.Graphics.Canvas.CanvasDrawingSession';
  }

  snapshot() {
    return {commands: snapshotDrawing(this.commands), depth: this.depth, closed: this.closed,
      maxCommands: this.maxCommands, maxDepth: this.maxDepth, elementId: this.elementId, version: this.version};
  }

  restore(snapshot) {
    this.commands = [...snapshot.commands]; this.depth = snapshot.depth; this.closed = snapshot.closed;
    this.maxCommands = snapshot.maxCommands; this.maxDepth = snapshot.maxDepth;
    this.elementId = snapshot.elementId; this.version = snapshot.version;
  }
}
