/** Enumerate direct class-member constructor signatures in O(tokens); method and nested-type bodies are skipped. */
export function constructorProbeCandidates(tokens, pairs, classes) {
  const candidates = [];
  for (const classIndex of classes) {
    const owner = tokens[classIndex + 1];
    if (owner?.kind !== 'identifier' || ['<', '('].includes(tokens[classIndex + 2]?.kind)) continue;
    let body = classIndex + 2;
    while (body < tokens.length && !['{', ';'].includes(tokens[body].kind)) body++;
    if (tokens[body]?.kind !== '{' || pairs[body] < 0) continue;
    const end = pairs[body];
    for (let index = body + 1; index < end; index++) {
      if (tokens[index].kind === 'identifier' && tokens[index].value === owner.value && tokens[index + 1]?.kind === '(') {
        candidates.push({index, owner: owner.value});
      }
      if (['{', '(', '['].includes(tokens[index].kind) && pairs[index] >= 0) index = pairs[index];
    }
  }
  return candidates;
}
