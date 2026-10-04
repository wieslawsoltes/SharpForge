const protocolErrors = new Set([
  'Protocol headers must be ASCII',
  'Malformed protocol header',
  'Invalid or duplicate Content-Length',
  'Only UTF-8 protocol bodies are supported',
  'Protocol envelope must be an object',
  'Incomplete or failed protocol stream',
]);
const protocolLimits = new Set([
  'Buffered protocol bytes exceed limit',
  'Protocol header exceeds limit',
  'Missing or excessive Content-Length',
  'Protocol message exceeds limit',
]);
const xmlErrors = new Set([
  'Expected XML name',
  'Unsupported or invalid XML entity',
  'Invalid XML comment',
  'Unterminated processing instruction',
  'Unterminated CDATA',
  'DTD and entity declarations are not permitted',
  'Expected closing >',
  'Mismatched closing tag',
  'Expected attribute separator',
  'Duplicate XML attribute',
  'Expected =',
  'Expected quoted attribute',
  'Unterminated attribute',
  'Invalid < in attribute',
  'XML node limit exceeded',
  'XML nesting limit exceeded',
  'XML must contain exactly one complete root',
]);
const conditionErrors = new Set([
  'Condition too long',
  'Expanded condition too long',
  'Incomplete condition',
  'Expected condition value',
  'Relational conditions require numeric or version operands',
  'Condition nesting limit',
  'Missing condition parenthesis',
  'Missing condition (',
  'Missing condition )',
  'Unsupported condition value',
  'Unsupported condition suffix',
]);

function rejected(code) {
  return { status: 'rejected', code };
}

/** Exact framing guards only; incidental TypeError/RangeError instances are findings. */
export function classifyProtocolError(error) {
  if (error?.constructor === Error && protocolErrors.has(error.message)) return rejected('PROTOCOL_FRAME');
  if (error?.constructor === RangeError && error.message === 'Protocol message exceeds limit') return rejected('FUZZ_OUTPUT_LIMIT');
  if (error?.constructor === RangeError && protocolLimits.has(error.message)) return rejected('PROTOCOL_LIMIT');
  if (error instanceof TypeError && error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') return rejected('PROTOCOL_UTF8');
  return null;
}

/** Project-system currently exposes Error messages, so recognize its finite validation vocabulary. */
export function classifyXmlError(error) {
  if (error?.constructor !== Error) return null;
  if (error.message === 'XML exceeds the text limit') return rejected('MSBUILD_XML_LIMIT');
  const match = /^(.*) at XML offset \d+$/.exec(error.message);
  return match && xmlErrors.has(match[1]) ? rejected('MSBUILD_XML') : null;
}

/** Native property functions have a distinct unsupported outcome; they are never evaluated. */
export function classifyConditionError(error) {
  if (error?.constructor !== Error) return null;
  if (error.message === 'MSBuild property functions require the native engine') {
    return { status: 'unsupported', code: 'MSBUILD_NATIVE_CONDITION' };
  }
  if (conditionErrors.has(error.message) || error.message.startsWith('Unsupported MSBuild condition: ')) {
    return rejected('MSBUILD_CONDITION');
  }
  return null;
}
