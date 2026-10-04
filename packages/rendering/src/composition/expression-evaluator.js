function componentwise(first, second, operation) {
  if (Array.isArray(first) || Array.isArray(second)) {
    const count = Array.isArray(first) ? first.length : second.length;
    if (Array.isArray(first) && Array.isArray(second) && first.length !== second.length) throw new TypeError('Expression vector size mismatch');
    return Array.from({length: count}, (_, index) => operation(Array.isArray(first) ? first[index] : first,
      Array.isArray(second) ? second[index] : second));
  }
  return operation(first, second);
}

const binary = Object.freeze({
  '+': (left, right) => left + right, '-': (left, right) => left - right, '*': (left, right) => left * right,
  '/': (left, right) => left / right, '%': (left, right) => left % right,
  '<': (left, right) => left < right, '<=': (left, right) => left <= right, '>': (left, right) => left > right,
  '>=': (left, right) => left >= right, '==': (left, right) => left === right, '!=': (left, right) => left !== right
});
const arities = Object.freeze({Clamp: 3, Lerp: 3, Min: 2, Max: 2, Abs: 1, Sin: 1, Cos: 1, Tan: 1, Sqrt: 1,
  Floor: 1, Ceil: 1, Round: 1, Pow: 2, Vector2: 2, Vector3: 3, Vector4: 4, Quaternion: 4, Length: 1, Normalize: 1, Dot: 2});
const functions = Object.freeze({
  Clamp: (value, min, max) => componentwise(componentwise(value, min, Math.max), max, Math.min),
  Lerp: (start, end, progress) => componentwise(start, componentwise(componentwise(end, start, binary['-']), progress, binary['*']), binary['+']),
  Min: (left, right) => componentwise(left, right, Math.min), Max: (left, right) => componentwise(left, right, Math.max),
  Abs: value => componentwise(value, 0, Math.abs), Sin: value => componentwise(value, 0, Math.sin),
  Cos: value => componentwise(value, 0, Math.cos), Tan: value => componentwise(value, 0, Math.tan),
  Sqrt: value => componentwise(value, 0, Math.sqrt), Floor: value => componentwise(value, 0, Math.floor),
  Ceil: value => componentwise(value, 0, Math.ceil), Round: value => componentwise(value, 0, Math.round),
  Pow: (left, right) => componentwise(left, right, Math.pow),
  Vector2: (x, y) => [x, y], Vector3: (x, y, z) => [x, y, z], Vector4: (x, y, z, w) => [x, y, z, w],
  Quaternion: (x, y, z, w) => [x, y, z, w], Length: value => Math.hypot(...value),
  Normalize: value => { const length = Math.hypot(...value); return value.map(component => component / length); },
  Dot: (left, right) => left.reduce((sum, component, index) => sum + component * right[index], 0)
});

function member(value, name) {
  if (Array.isArray(value) && /^[XYZWRGBAxyzwrgba]{1,4}$/.test(name)) {
    const indexes = {X: 0, R: 0, Y: 1, G: 1, Z: 2, B: 2, W: 3, A: 3};
    const result = [...name.toUpperCase()].map(component => value[indexes[component]]);
    if (result.some(component => component === undefined)) throw new TypeError('Invalid vector swizzle');
    return result.length === 1 ? result[0] : result;
  }
  if (value?.schema && Object.hasOwn(value.schema, name)) return value.get(name);
  if (value?.values instanceof Map && typeof value.get === 'function') return value.get(name);
  if (value && Object.hasOwn(value, name)) return value[name];
  throw new TypeError(`Unknown composition expression property: ${name}`);
}

/** Expressions can read only supplied parameters and documented model properties. */
export function evaluateCompositionExpression(ast, parameters, {maxOperations = 2048} = {}) {
  let operations = 0;
  const evaluate = node => {
    if (++operations > maxOperations) throw new RangeError('Composition expression operation limit exceeded');
    if (node.type === 'literal') return node.value;
    if (node.type === 'reference') {
      if (node.name === 'Pi') return Math.PI;
      if (node.name === 'true') return true;
      if (node.name === 'false') return false;
      if (!Object.hasOwn(parameters, node.name)) throw new TypeError(`Unknown expression parameter: ${node.name}`);
      return parameters[node.name];
    }
    if (node.type === 'member') return member(evaluate(node.object), node.name);
    if (node.type === 'conditional') return evaluate(node.condition) ? evaluate(node.yes) : evaluate(node.no);
    if (node.type === 'unary') {
      const value = evaluate(node.operand);
      if (node.operator === '!') return !value;
      return componentwise(value, node.operator === '-' ? -1 : 1, binary['*']);
    }
    if (node.type === 'binary') {
      const left = evaluate(node.left);
      if (node.operator === '&&') return left && evaluate(node.right);
      if (node.operator === '||') return left || evaluate(node.right);
      return componentwise(left, evaluate(node.right), binary[node.operator]);
    }
    if (node.type === 'call') {
      const callback = functions[node.name];
      if (!callback || node.args.length !== arities[node.name]) throw new TypeError(`Unknown expression function or arity: ${node.name}`);
      return callback(...node.args.map(evaluate));
    }
    throw new TypeError('Malformed composition expression AST');
  };
  const result = evaluate(ast);
  const values = Array.isArray(result) ? result : [result];
  if (values.some(value => typeof value !== 'boolean' && !Number.isFinite(value))) throw new RangeError('Nonfinite composition expression result');
  return result;
}
