/** XAML diagnostics retain source offsets and one-based line/column for managed XamlParseException. */
export class XamlParseException extends Error {
  constructor(code, message, span = null, cause = null) {
    const position = span ?? {start: 0, length: 0, line: 1, column: 1};
    super(`${message} (line ${position.line}, position ${position.column})`, cause ? {cause} : undefined);
    this.name = 'XamlParseException';
    this.code = code;
    this.span = position;
    this.lineNumber = this.span.line;
    this.linePosition = this.span.column;
  }
}

export function xamlFault(code, message, context = {}, cause = null) {
  return new XamlParseException(code, message, context.span, cause);
}
