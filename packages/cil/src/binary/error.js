/** Invalid CIL binary input, with an optional byte offset retained by existing callers. */
export class CilError extends Error {
  constructor(message, offset) {
    super(offset === undefined ? message : `${message} at 0x${offset.toString(16)}`);
    this.name = 'CilError';
    this.offset = offset;
  }
}
