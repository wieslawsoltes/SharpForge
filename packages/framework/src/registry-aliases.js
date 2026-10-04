/** Only declared closed types gain the comma-compacted spelling used by CLI signature normalization. */
export function registerTypeAliases(aliases, name, failure) {
  const closed = name.includes('<') && name.endsWith('>');
  const compact = closed ? name.replace(/,\s+/g, ',') : name;
  for (const alias of closed ? new Set([name, compact]) : []) {
    const previous = aliases.get(alias);
    if (previous && previous !== name) throw failure('Conflicting registered type alias ' + alias + ' for ' + previous + ' and ' + name);
  }
  aliases.set(name, name);
  if (compact !== name) aliases.set(compact, name);
  const short = name.slice(name.lastIndexOf('.') + 1);
  if (!aliases.has(short)) aliases.set(short, name);
}
