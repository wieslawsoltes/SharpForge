import { base64Url, requireCrypto } from '../auth/security.js';

/** Byte-preserving Bitbucket multipart upload with executable/symlink attributes. */
export function sourceMultipart(files, metadata, crypto = globalThis.crypto) {
  const boundary = `sharpforge-${base64Url(requireCrypto(crypto).getRandomValues(new Uint8Array(24)))}`;
  const encoder = new TextEncoder();
  const chunks = [];
  const text = value => chunks.push(encoder.encode(value));
  for (const [name, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    text(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  for (const file of files) {
    if (file.delete) {
      text(`--${boundary}\r\nContent-Disposition: form-data; name="files"\r\n\r\n/${file.path}\r\n`);
      continue;
    }
    const name = `/${file.path}`.replace(/"/g, '%22');
    const attribute = file.mode === '100755' ? '; x-attributes="executable"' : file.mode === '120000' ? '; x-attributes="link"' : '';
    text(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="file"${attribute}\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n');
    chunks.push(file.content);
    text('\r\n');
  }
  text(`--${boundary}--\r\n`);
  const body = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
