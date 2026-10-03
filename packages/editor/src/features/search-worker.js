import {findTextMatches} from '@sharpforge/text';

const documents = [];
let current;

globalThis.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'document') {
    current = {uri: message.uri, version: message.version, chunks: []};
    documents.push(current);
  } else if (message.type === 'chunk') {
    if (!current) throw new Error('Search worker received text before a document');
    current.chunks.push(message.text);
  } else if (message.type === 'search') {
    try {
      const snapshots = documents.map(document => ({uri: document.uri, version: document.version, text: document.chunks.join('')}));
      const result = findTextMatches(snapshots, message.query, message.options);
      globalThis.postMessage({result});
    } catch (error) {
      globalThis.postMessage({error: {name: error.name, message: error.message, code: error.code, position: error.position}});
    }
  }
});
