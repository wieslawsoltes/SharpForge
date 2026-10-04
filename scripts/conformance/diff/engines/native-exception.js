// Pinned CLR termination conventions, not evidence from matching application text alone:
// https://learn.microsoft.com/en-us/shows/inside/e0434352
// https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/pal/src/thread/process.cpp
export function isClrExceptionTermination(raw, platform = process.platform) {
  if (platform === 'win32') return raw.signal === null && Number.isInteger(raw.exitCode) &&
    raw.exitCode >= -2147483648 && raw.exitCode <= 4294967295 && (raw.exitCode >>> 0) === 0xe0434352;
  return ['linux', 'darwin'].includes(platform) && raw.signal === 'SIGABRT';
}

/** Separate one recognisable terminal CLR diagnostic; retain ambiguous stderr in full. */
export function splitNativeException(raw, platform = process.platform) {
  const absent = { exception: null, exceptionDiagnostic: null };
  if (!isClrExceptionTermination(raw, platform) || typeof raw.stderr !== 'string') return absent;
  // A preceding Console.Error.Write need not end in a newline. Its exact prefix survives.
  const headers = [...raw.stderr.matchAll(/Unhandled exception\. ([A-Za-z_][A-Za-z0-9_.+`]*(?:\[[^\r\n]*\])?)(?:: ([^\r\n]*))?\r?$/gm)];
  if (headers.length !== 1) return absent;
  const header = headers[0], diagnostic = raw.stderr.slice(header.index), lines = diagnostic.split(/\r?\n/);
  const frame = line => /^[ \t]+at [^\r\n]+$/.test(line);
  const firstFrame = lines.findIndex(frame);
  if (firstFrame < 1) return absent;
  const marker = line => /^[ \t]*--- End of (?:inner exception stack trace|stack trace from previous location) ---$/.test(line);
  // Unrecognised text interleaved after frames may be application output, so do not hide it.
  if (!lines.slice(firstFrame).every(line => line === '' || frame(line) || marker(line))) return absent;
  // Multiline messages precede the first stack frame and remain observable as exception text.
  const stackStart=diagnostic.search(/^[ \t]+at /m), beforeStack=diagnostic.slice(0,stackStart).replace(/\r?\n$/,'');
  let message=(header[2]??'')+beforeStack.slice(header[0].replace(/\r$/,'').length);
  if(lines.slice(firstFrame).some(line=>/^[ \t]*--- End of inner exception stack trace ---$/.test(line))){
    const separators=[...message.matchAll(/(?:\r?\n[ \t]*| )---> /g)];
    if(separators.length!==1)return absent;
    message=message.slice(0,separators[0].index);
  }
  return { exception: { type: header[1], message }, exceptionDiagnostic: diagnostic };
}
