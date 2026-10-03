import {authoringError} from './property-diagnostics.js';

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

/** The caller grants asset bytes explicitly; object URLs are revoked when a picker or document closes. */
export class DesignerAssetPreviewStore {
  constructor({readAsset, createObjectURL, revokeObjectURL, makeBlob} = {}) {
    this.readAsset = readAsset;
    this.createObjectURL = createObjectURL;
    this.revokeObjectURL = revokeObjectURL;
    this.makeBlob = makeBlob;
    this.urls = new Map();
    this.disposed = false;
  }

  async preview(asset) {
    if (this.disposed) authoringError('SFD1863', 'Asset preview store has closed.');
    if (this.urls.has(asset.path)) return this.urls.get(asset.path);
    if (!this.readAsset || !this.createObjectURL || !this.makeBlob) authoringError('SFD1863', 'Project asset preview service is unavailable.');
    const bytes = await this.readAsset(asset.path);
    if (!bytes || bytes.byteLength > 8 * 1024 * 1024) authoringError('SFD1863', 'Image preview requires an asset no larger than 8 MiB.');
    if (this.disposed) authoringError('SFD1863', 'Asset picker closed while the image was loading.');
    const url = this.createObjectURL(this.makeBlob(bytes, asset.mimeType));
    this.urls.set(asset.path, url);
    return url;
  }

  resolve(uri) {
    for (const [path, url] of this.urls) if (designerAssetUri(path) === uri || path === uri) return url;
    return null;
  }

  dispose() {
    this.disposed = true;
    for (const url of this.urls.values()) this.revokeObjectURL?.(url);
    this.urls.clear();
  }
}
