/** Netmodule compiler scaffolding stays internal so separate modules can export their own public types. */
export function emissionTypeDescriptors(image, options) {
  const hidden = options.outputKind === 'netmodule' ? 1 : 0;
  return [
    { name: '<Module>', namespace: '', flags: 0, original: null },
    { name: '<>Program', namespace: 'SharpForge', flags: 0x100181 - hidden, original: null, program: true },
    { name: '<>AllocationToken', namespace: 'SharpForge', flags: 0x100101 - hidden, original: null, marker: true },
    ...image.types.map(type => ({ name: type.name, namespace: '', flags: image.outputKind === 'library' ? 1 : 0x100001,
      original: type })),
  ];
}
