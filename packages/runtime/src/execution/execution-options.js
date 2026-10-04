const defaultStackBytes = 4 * 1024 * 1024;

/** Bound the VM-wide logical stack by bytes; hosts may additionally cap call depth. */
export function executionOptions(options) {
  return {
    maxInstructions: 20_000_000,
    maxFrames: Infinity,
    maxStackValues: 65536,
    maxOutputCharacters: 1_000_000,
    ...options,
    maxStackBytes: options.maxStackBytes === undefined ? defaultStackBytes : options.maxStackBytes
  };
}
