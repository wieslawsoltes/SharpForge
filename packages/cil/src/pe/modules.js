import { CilError } from '../binary.js';

/** Choose the Module name and whether this image owns an Assembly manifest. */
export function moduleManifest(name, options) {
  const netmodule = options.outputKind === 'netmodule' || options.outputKind === 'module';
  if (!netmodule) {
    if (options.moduleName !== undefined) throw new CilError('moduleName is supported only for netmodule output');
    return { name: name + '.dll', hasAssembly: true };
  }
  if (options.assemblyVersion !== undefined || options.assemblyCulture !== undefined || options.publicKey !== undefined
    || options.publicSign || options.delaySign || options.signAssembly) {
    throw new CilError('Netmodules have no Assembly identity and cannot be independently signed');
  }
  const moduleName = options.moduleName ?? name.replace(/\.netmodule$/i, '') + '.netmodule';
  if (typeof moduleName !== 'string' || !moduleName || moduleName.length > 512 || /[\0/\\]/.test(moduleName)) {
    throw new CilError('Invalid netmodule file name');
  }
  return { name: moduleName, hasAssembly: false };
}
