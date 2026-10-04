const safeText = (value, allowEmpty = false) => typeof value === 'string' && value.length <= 4096
  && (allowEmpty || value.length > 0) && !value.includes('\0');

export function validProjectIdentity(identity) {
  return !!identity && safeText(identity.name) && safeText(identity.cultureName, true)
    && Array.isArray(identity.version) && identity.version.length === 4
    && identity.version.every(part => Number.isInteger(part) && part >= 0 && part <= 65535)
    && typeof identity.publicKeyToken === 'string' && /^(?:[0-9a-f]{16})?$/.test(identity.publicKeyToken)
    && typeof identity.isRetargetable === 'boolean'
    && ['default', 'windowsRuntime'].includes(identity.contentType);
}

/** Format an explicit full assembly identity using the compiler's AssemblyIdentity display convention. */
export function projectAssemblyKey(identity) {
  if (!validProjectIdentity(identity)) throw new TypeError('Invalid project assembly identity');
  const name = identity.name.replace(/[\\,="']/g, character => '\\' + character);
  return name + ', Version=' + identity.version.join('.') + ', Culture=' + (identity.cultureName || 'neutral')
    + ', PublicKeyToken=' + (identity.publicKeyToken || 'null')
    + (identity.isRetargetable ? ', Retargetable=Yes' : '')
    + (identity.contentType === 'windowsRuntime' ? ', ContentType=WindowsRuntime' : '');
}
