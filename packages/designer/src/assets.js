import {DesignerAuthoringError, authoringError, finiteNumber} from './property-diagnostics.js';

const imageTypes = Object.freeze({png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon'});

/** Paths are workspace-relative and never contain a scheme, traversal, query, fragment or credentials. */
export function normalizeDesignerAssetPath(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f?#:]/.test(value)) {
    authoringError('SFD1863', 'Choose a valid project-relative asset path.');
  }
  const path = value.replaceAll('\\', '/');
  if (path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    authoringError('SFD1863', 'Asset paths must remain inside the project.');
  }
  return path;
}

export function designerAssetUri(path, {basePath = ''} = {}) {
  path = normalizeDesignerAssetPath(path);
  if (basePath) {
    const base = normalizeDesignerAssetPath(basePath).split('/').slice(0, -1);
    const target = path.split('/');
    let common = 0;
    while (common < base.length && common < target.length && base[common] === target[common]) common++;
    return [...Array(base.length - common).fill('..'), ...target.slice(common)].map(part => part === '..' ? part : encodeURIComponent(part)).join('/');
  }
  return path.split('/').map(encodeURIComponent).join('/');
}

export function designerAssets(records, {search = '', maximum = 10000} = {}) {
  if (!Array.isArray(records) || records.length > maximum) authoringError('SFD1863', 'Project asset inventory limit.');
  const query = search.toLocaleLowerCase('en-US');
  const result = [];
  for (const record of records) {
    const extension = record.path?.split('.').at(-1).toLowerCase();
    const mimeType = imageTypes[extension];
    if (!mimeType || !record.path.toLocaleLowerCase('en-US').includes(query)) continue;
    const path = normalizeDesignerAssetPath(record.path);
    result.push({path, name: path.split('/').at(-1), mimeType, bytes: record.bytes?.byteLength ?? record.size ?? null,
      uri: designerAssetUri(path)});
  }
  return result.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

/** Resolves only exact project inventory paths/URIs; it never grants a remote origin or reads bytes. */
export function referencedDesignerAssets(scene, records, {resolveAsset = () => null, basePath = ''} = {}) {
  if (!Array.isArray(scene?.nodes) || scene.nodes.length > 10000) authoringError('SFD1863', 'Invalid image preview scene.');
  const inventory = new Map();
  for (const asset of designerAssets(records)) {
    inventory.set(asset.uri, asset);
    inventory.set(asset.path, asset);
    if (basePath) inventory.set(designerAssetUri(asset.path, {basePath}), asset);
  }
  const assets = new Map();
  const diagnostics = [];
  const seen = new Set();
  for (const node of scene.nodes) {
    const source = node.properties?.Source;
    if (!source || typeof source !== 'string' || seen.has(source) || resolveAsset(source)) continue;
    seen.add(source);
    const asset = inventory.get(source);
    if (asset) assets.set(asset.path, asset);
    else diagnostics.push({code: 'SFD1863', severity: 'error', span: null, nodeId: node.designId ?? node.id,
      message: `Image source ${source.slice(0, 200)} is not an authorized project image.`});
  }
  return {assets: [...assets.values()], diagnostics};
}

/** The caller grants asset bytes explicitly; object URLs are revoked when a picker or document closes. */
export class DesignerAssetPreviewStore {
  constructor({readAsset, createObjectURL, revokeObjectURL, makeBlob,
    maxBytes = 64 * 1024 * 1024, maxEntries = 512, maxConcurrent = 4} = {}) {
    this.readAsset = readAsset;
    this.createObjectURL = createObjectURL;
    this.revokeObjectURL = revokeObjectURL;
    this.makeBlob = makeBlob;
    this.urls = new Map();
    this.pending = new Map();
    this.maxBytes = finiteNumber(maxBytes, {label: 'Preview byte budget', minimum: 1, maximum: 256 * 1024 * 1024, integer: true});
    this.maxEntries = finiteNumber(maxEntries, {label: 'Preview entry budget', minimum: 1, maximum: 10000, integer: true});
    this.maxConcurrent = finiteNumber(maxConcurrent, {label: 'Concurrent image reads', minimum: 1, maximum: 32, integer: true});
    this.active = 0;
    this.waiting = new Set();
    this.byteLength = 0;
    this.disposed = false;
  }

  async preview(asset) {
    if (this.disposed) authoringError('SFD1863', 'Asset preview store has closed.');
    asset = {...asset, path: normalizeDesignerAssetPath(asset?.path)};
    if (imageTypes[asset.path.split('.').at(-1).toLowerCase()] !== asset.mimeType) {
      authoringError('SFD1863', 'Asset previews require a recognized image type.');
    }
    if (this.urls.has(asset.path)) return this.urls.get(asset.path);
    if (this.pending.has(asset.path)) return this.pending.get(asset.path);
    if (this.urls.size + this.pending.size >= this.maxEntries) authoringError('SFD1863', 'The image-preview entry budget is exhausted.');
    if ([this.readAsset, this.createObjectURL, this.revokeObjectURL, this.makeBlob].some(service => typeof service !== 'function')) {
      authoringError('SFD1863', 'Project asset preview service is unavailable.');
    }
    const pending = this.loadPreview(asset);
    this.pending.set(asset.path, pending);
    try { return await pending; }
    finally { this.pending.delete(asset.path); }
  }

  async loadPreview(asset) {
    await this.acquire();
    try {
      if (this.disposed) authoringError('SFD1863', 'Asset preview store has closed.');
      const bytes = await this.readAsset(asset.path);
      if (!(bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) || bytes.byteLength > 8 * 1024 * 1024) {
        authoringError('SFD1863', 'Image preview requires bytes for an asset no larger than 8 MiB.');
      }
      if (this.disposed) authoringError('SFD1863', 'Asset picker closed while the image was loading.');
      if (this.byteLength + bytes.byteLength > this.maxBytes) authoringError('SFD1863', 'The image-preview memory budget is exhausted.');
      const url = this.createObjectURL(this.makeBlob(bytes, asset.mimeType));
      this.urls.set(asset.path, url);
      this.byteLength += bytes.byteLength;
      return url;
    } finally { this.release(); }
  }

  async acquire() {
    if (this.active < this.maxConcurrent) this.active++;
    else await new Promise((resolve, reject) => this.waiting.add({resolve, reject}));
    if (this.disposed) {
      this.release();
      authoringError('SFD1863', 'Asset preview store has closed.');
    }
  }

  release() {
    const next = this.waiting.values().next().value;
    if (!next || this.disposed) this.active--;
    else { this.waiting.delete(next); next.resolve(); }
  }

  resolve(uri) {
    for (const [path, url] of this.urls) if (designerAssetUri(path) === uri || path === uri || url === uri) return url;
    return null;
  }

  dispose() {
    this.disposed = true;
    for (const url of this.urls.values()) this.revokeObjectURL?.(url);
    this.urls.clear();
    this.pending.clear();
    for (const waiting of this.waiting) waiting.reject(new DesignerAuthoringError('SFD1863', 'Asset preview store has closed.'));
    this.waiting.clear();
    this.byteLength = 0;
  }
}
