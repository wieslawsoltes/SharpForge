/** Exact source and permission equality; text equality alone must not reuse a writable partial-file baseline. */
export function sameDesignerSources(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const files = new Map(left.map(file => [file.uri, file]));
  if (files.size !== left.length || new Set(right.map(file => file.uri)).size !== right.length) return false;
  return right.every(file => {
    const previous = files.get(file.uri);
    return previous?.text === file.text && previous.version === file.version
      && !!(previous.readOnly || previous.readonly) === !!(file.readOnly || file.readonly);
  });
}
