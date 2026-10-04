export const booleanStorageType = 'System.Boolean';

function validateBoolean(value) {
  if (typeof value !== 'boolean' && value !== 0 && value !== 1) {
    throw new TypeError('Boolean array element requires a boolean');
  }
}

function validateByte(value) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new TypeError('CLI Boolean storage requires a normalized unsigned byte');
  }
}

/** Managed access projects a byte to Boolean; CLI access retains the exact byte pattern. */
export const booleanStorage = Object.freeze({
  size: 1,
  arrayType: null,
  validate: validateBoolean,
  validateRaw: validateByte,
  read(view, offset) { return view.getUint8(offset) !== 0; },
  write(view, offset, value) {
    validateBoolean(value);
    view.setUint8(offset, value ? 1 : 0);
  },
  readRaw(view, offset) { return view.getUint8(offset); },
  writeRaw(view, offset, value) {
    validateByte(value);
    view.setUint8(offset, value);
  },
  toManaged(value) { return value !== 0; },
  synchronize(view, offset, value) {
    validateBoolean(value);
    // Reading a host wrapper must not rewrite a noncanonical true byte. An
    // explicit managed write still uses write() and stores precisely zero/one.
    if (typeof value !== 'boolean' || value !== (view.getUint8(offset) !== 0)) {
      view.setUint8(offset, value ? 1 : 0);
    }
  }
});

export function hasBooleanStorage(record) {
  return record.storage?.elementType === booleanStorageType;
}
