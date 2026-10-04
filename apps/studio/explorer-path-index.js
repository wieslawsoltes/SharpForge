function prefixes(path) {
  const result = [];
  let separator = path.indexOf('/');
  while (separator >= 0) {
    result.push(path.slice(0, separator));
    separator = path.indexOf('/', separator + 1);
  }
  result.push(path);
  return result;
}

/** Prefix counts make bulk collision checks depend on path depth rather than rescanning every workspace file. */
export class ExplorerPathIndex {
  constructor(records, folders) {
    this.files = new Set();
    this.counts = new Map();
    for (const path of records) this.add(path, true);
    for (const path of folders) this.add(path, false);
  }

  add(path, file) {
    const folded = path.normalize('NFC').toLowerCase();
    if (file) this.files.add(folded);
    for (const prefix of prefixes(folded)) this.counts.set(prefix, (this.counts.get(prefix) ?? 0) + 1);
  }

  remove(path, file) {
    const folded = path.normalize('NFC').toLowerCase();
    if (file) this.files.delete(folded);
    for (const prefix of prefixes(folded)) {
      const remaining = this.counts.get(prefix) - 1;
      if (remaining) this.counts.set(prefix, remaining); else this.counts.delete(prefix);
    }
  }

  assertAvailable(path) {
    const folded = path.normalize('NFC').toLowerCase();
    if (this.counts.has(folded)) throw new Error('Destination already exists: ' + path);
    for (const parent of prefixes(folded).slice(0, -1)) {
      if (this.files.has(parent)) throw new Error('A parent path is a file: ' + parent);
    }
  }
}
