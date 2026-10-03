import {searchDocuments} from './search-engine.js';

self.onmessage = event => {
  const {documents, query, options} = event.data;
  try {
    const result = searchDocuments(documents, query, {...options,
      onProgress: progress => self.postMessage({type: 'progress', progress})});
    self.postMessage({type: 'result', result});
  } catch (error) {
    self.postMessage({type: 'error', error: {name: error.name, message: error.message}});
  }
};
