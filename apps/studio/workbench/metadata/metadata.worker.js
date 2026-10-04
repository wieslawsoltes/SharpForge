import {inspectMetadata} from './assembly-model.js';

self.onmessage = event => {
  try {
    const result = inspectMetadata(event.data.bytes, {source: event.data.source});
    self.postMessage({type: 'result', result});
  } catch (error) {
    self.postMessage({type: 'error', error: {name: error.name, code: error.code ?? 'METADATA_INVALID', message: error.message}});
  }
};
