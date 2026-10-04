/** API recorder for deterministic backend tests. It does not rasterize pixels or qualify visual parity. */
export function createRecordingDocument(gpuContext) {
  const canvases = [];
  const document = {canvases, defaultView: {performance: {now: () => 0}}, createElement(name) {
    if (name !== 'canvas') throw new TypeError('Recording document supports only canvas elements');
    const canvas = new RecordingCanvas(document, gpuContext);
    canvases.push(canvas);
    return canvas;
  }};
  return document;
}

export class RecordingCanvas {
  constructor(document, gpuContext) {
    this.ownerDocument = document;
    this.width = 1;
    this.height = 1;
    this.calls = [];
    this.style = {};
    this.context = new RecordingContext(this);
    this.gpuContext = gpuContext?.(this);
  }
  getContext(kind) { return kind === '2d' ? this.context : kind === 'webgpu' ? this.gpuContext : null; }
  setAttribute(name, value) { this[name] = value; }
  remove() { this.removed = true; }
}

class RecordingContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this.stack = [];
    this.matrix = [1, 0, 0, 1, 0, 0];
  }
  record(name, args) { this.canvas.calls.push({name, args: [...args], alpha: this.globalAlpha, operation: this.globalCompositeOperation}); }
  save() {
    this.record('save', []);
    this.stack.push({alpha: this.globalAlpha, operation: this.globalCompositeOperation, matrix: [...this.matrix]});
  }
  restore() {
    const state = this.stack.pop();
    if (!state) throw new Error('Canvas state stack underflow');
    this.globalAlpha = state.alpha;
    this.globalCompositeOperation = state.operation;
    this.matrix = state.matrix;
    this.record('restore', []);
  }
  setTransform(...args) { this.matrix = args; this.record('setTransform', args); }
  transform(...args) { this.record('transform', args); }
  translate(...args) { this.record('translate', args); }
  scale(...args) { this.record('scale', args); }
  beginPath() { this.record('beginPath', []); }
  closePath() { this.record('closePath', []); }
  moveTo(...args) { this.record('moveTo', args); }
  lineTo(...args) { this.record('lineTo', args); }
  bezierCurveTo(...args) { this.record('bezierCurveTo', args); }
  quadraticCurveTo(...args) { this.record('quadraticCurveTo', args); }
  arc(...args) { this.record('arc', args); }
  ellipse(...args) { this.record('ellipse', args); }
  rect(...args) { this.record('rect', args); }
  clip(...args) { this.record('clip', args); }
  fill(...args) { this.record('fill', args); }
  fillRect(...args) { this.record('fillRect', args); }
  clearRect(...args) { this.record('clearRect', args); }
  drawImage(...args) { this.record('drawImage', args); }
  fillText(...args) { this.record('fillText', args); }
  putImageData(...args) { this.record('putImageData', args); }
  createImageData(width, height) { return {width, height, data: new Uint8ClampedArray(width * height * 4)}; }
  getImageData(x, y, width, height) { return this.createImageData(width, height); }
  createPattern() { return {setTransform() {}}; }
  createLinearGradient() { return {addColorStop() {}}; }
  createRadialGradient() { return {addColorStop() {}}; }
}
