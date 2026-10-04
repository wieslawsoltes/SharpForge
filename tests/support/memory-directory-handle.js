/** Independent File System Access test double with transactional close and explicit fault injection. */
export function memoryDirectory({name = 'recovery', beforeClose = () => {}} = {}) {
  function directory(label, path = '') {
    const children = new Map();
    const missing = item => new DOMException('Entry not found: ' + item, 'NotFoundError');
    return {
      kind: 'directory', name: label,
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
      async getDirectoryHandle(item, {create = false} = {}) {
        if (!children.has(item)) {
          if (!create) throw missing(item);
          children.set(item, directory(item, path + item + '/'));
        }
        const entry = children.get(item);
        if (entry.kind !== 'directory') throw new DOMException('Not a directory', 'TypeMismatchError');
        return entry;
      },
      async getFileHandle(item, {create = false} = {}) {
        if (!children.has(item)) {
          if (!create) throw missing(item);
          let content = new Uint8Array();
          children.set(item, {
            kind: 'file', name: item,
            async queryPermission() { return 'granted'; },
            async requestPermission() { return 'granted'; },
            async getFile() { return new File([content], item, {lastModified: 1}); },
            async createWritable() {
              let pending = content.slice(), finished = false;
              return {
                async write(value) {
                  if (finished) throw new Error('Stream closed');
                  pending = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) :
                    typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value).slice();
                },
                async close() {
                  if (finished) throw new Error('Stream closed');
                  await beforeClose(path + item, pending);
                  content = pending;
                  finished = true;
                },
                async abort() { finished = true; },
              };
            },
          });
        }
        const entry = children.get(item);
        if (entry.kind !== 'file') throw new DOMException('Not a file', 'TypeMismatchError');
        return entry;
      },
      async removeEntry(item) {
        if (!children.delete(item)) throw missing(item);
      },
      async *entries() { yield* children.entries(); },
      async *values() { yield* children.values(); },
    };
  }
  return directory(name);
}

export async function setHandleText(directory, name, text) {
  const stream = await (await directory.getFileHandle(name, {create: true})).createWritable();
  await stream.write(text);
  await stream.close();
}
