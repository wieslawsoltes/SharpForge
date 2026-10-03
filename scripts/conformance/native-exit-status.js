/** Node reports Windows DWORD exit statuses unsigned; POSIX wait status is 8 bits. */
export function nativeExitStatus(managedCode, platform = process.platform) {
  if (!Number.isInteger(managedCode) || managedCode < -2147483648 || managedCode > 2147483647) throw new RangeError('Managed exit code must be a signed Int32');
  return platform === 'win32' ? managedCode >>> 0 : managedCode & 255;
}
