/** Compatibility adapter for callers constructing DiskWorkspace with previously captured file handles. */
export function createHandleMapRoot(handles, textHandles = new Set()) {
  const missing = name => Object.assign(new Error('No write handle for ' + name + '; reopen its containing folder'), {name: 'NotFoundError'});
  const node = name => ({name, kind: 'directory', children: new Map(),
    async *entries() { yield* this.children; },
    async getDirectoryHandle(child) {
      const handle = this.children.get(child);
      if (handle?.kind !== 'directory') throw missing(child);
      return handle;
    },
    async getFileHandle(child) {
      const handle = this.children.get(child);
      if (handle?.kind !== 'file') throw missing(child);
      return handle;
    }
  });
  const root = node('Selected files');
  for (const [path, handle] of handles) {
    const parts = path.split('/');
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      if (!directory.children.has(part)) directory.children.set(part, node(part));
      directory = directory.children.get(part);
    }
    const name = parts.at(-1);
    const wrapped = {
      kind: 'file', name,
      getFile: async () => {
        const file = await handle.getFile();
        return typeof file.arrayBuffer === 'function' ? file : new File([await file.text()], name);
      },
      createWritable: async () => {
        const stream = await handle.createWritable();
        return {write: value => stream.write(textHandles.has(path) ? new TextDecoder().decode(value) : value),
          close: () => stream.close(), abort: () => stream.abort?.()};
      }
    };
    for (const method of ['queryPermission', 'requestPermission']) {
      if (typeof handle[method] === 'function') wrapped[method] = options => handle[method](options);
    }
    directory.children.set(name, wrapped);
  }
  return root;
}
