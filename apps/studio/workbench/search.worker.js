import {searchDocuments} from './search-engine.js';
import {scanCommentTasks} from './comment-tasks.js';

self.onmessage = async event => {
  const {documents, query, options, operation, tokens} = event.data;
  try {
    const onProgress = progress => self.postMessage({type: 'progress', progress});
    const result = operation === 'comment-tasks' ? await scanCommentTasks(documents, tokens, {onProgress}) :
      searchDocuments(documents, query, {...options, onProgress});
    self.postMessage({type: 'result', result});
  } catch (error) {
    self.postMessage({type: 'error', error: {name: error.name, message: error.message}});
  }
};
