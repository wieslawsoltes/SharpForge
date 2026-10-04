/** Stable diagnostic raised by the resource/style/template services. */
export class ResourceFault extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ResourceFault';
    this.code = code;
    this.details = details;
  }
}

export function requireResource(condition, code, message, details) {
  if (!condition) throw new ResourceFault(code, message, details);
}
