import {readEditorSource} from '@sharpforge/editor';
import {studioDiskLimits} from './workspace-limits.js';

/** Opt-in File/Blob ingress. A prepared model transfers to DocumentService only after workspace validation succeeds. */
export function readStudioSource(file, {path = file.webkitRelativePath || file.name, signal, limits = studioDiskLimits,
  version = 1, chunkSize = 256 * 1024, onProgress, encoding, maxCharacters = limits.maxFileBytes} = {}) {
  return readEditorSource(file, {uri: path, version, signal, chunkSize, onProgress, encoding,
    maxFileBytes: limits.maxFileBytes, maxCharacters});
}
