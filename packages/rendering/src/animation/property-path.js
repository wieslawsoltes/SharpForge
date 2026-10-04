/** Parse dependency-property paths without evaluating user code or accepting indexers. */
export function parseAnimationPropertyPath(source, {maxLength = 512, maxDepth = 32} = {}) {
  if (typeof source !== 'string' || !source.length || source.length > maxLength) throw new TypeError('A bounded animation property path is required');
  const result = [];
  let position = 0;
  while (position < source.length) {
    if (result.length >= maxDepth) throw new RangeError('Animation property path depth exceeded');
    let text;
    let qualified = false;
    if (source[position] === '(') {
      const end = source.indexOf(')', ++position);
      if (end < 0) throw new SyntaxError('Unclosed animation property path segment');
      text = source.slice(position, end);
      position = end + 1;
      qualified = true;
    } else {
      const start = position;
      while (position < source.length && source[position] !== '.') position++;
      text = source.slice(start, position);
    }
    if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(text)) throw new SyntaxError('Invalid animation property path segment');
    const split = qualified ? text.lastIndexOf('.') : -1;
    result.push({owner: split < 0 ? null : text.slice(0, split), name: split < 0 ? text : text.slice(split + 1)});
    if (position < source.length) {
      if (source[position++] !== '.' || position === source.length) throw new SyntaxError('Invalid animation property path separator');
    }
  }
  return result;
}

/** Resolve and validate the whole chain before Begin mutates any active animation. */
export function resolveAnimationTarget(target, path, {read, property, attached, ownerMatches} = {}) {
  let parts = parseAnimationPropertyPath(path);
  if (typeof path === 'string' && !path.includes('(') && path.includes('.')) {
    const separator = path.lastIndexOf('.');
    const owner = path.slice(0, separator);
    const name = path.slice(separator + 1);
    if (attached?.(target, owner, name)) parts = [{owner, name}];
  }
  let object = target;
  for (let index = 0; index < parts.length; index++) {
    const segment = parts[index];
    const attachedProperty = segment.owner && attached?.(object, segment.owner, segment.name);
    if (segment.owner && !attachedProperty && ownerMatches && !ownerMatches(object, segment.owner)) {
      throw new TypeError(`Animation property owner does not match: ${segment.owner}`);
    }
    const name = attachedProperty ?? segment.name;
    const info = property(object, name);
    if (!info) throw new TypeError(`Unknown animation property: ${segment.name}`);
    if (index === parts.length - 1) {
      if (info.readOnly) throw new TypeError('Animation target property is read-only');
      return {object, property: name, info};
    }
    object = read(object, name);
    if (object === null || object === undefined) throw new TypeError(`Animation property path is null at ${segment.name}`);
  }
  throw new TypeError('Empty animation property path');
}
