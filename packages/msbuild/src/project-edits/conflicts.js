/** Apply one optimistic edit through NativeWorkspace's hash-checked write transaction. */
export async function applyProjectEdit(workspace, request, options = {}) {
  const {path, baseText, expectedHash, text} = request;
  const {signal} = options;
  if (typeof baseText !== 'string' || typeof text !== 'string' || typeof expectedHash !== 'string') {
    throw new Error('Project edits require base text, replacement text and the previously read disk hash');
  }
  signal?.throwIfAborted();
  const current = await workspace.read(path);
  signal?.throwIfAborted();
  const conflict = value => ({applied: false, code: 'SFP2105', path, expectedHash, actualHash: value.hash,
    conflict: {base: baseText, local: text, remote: value.text}});
  if (current.hash !== expectedHash) return conflict(current);
  try {
    const result = await workspace.save([{path, expectedHash, text}]);
    return {applied: true, path, hash: result.written[0].hash, result};
  } catch (error) {
    if (error.status !== 409) throw error;
    return conflict(await workspace.read(path));
  }
}
