/** Send one JSON response through the native protocol boundary. */
export function sendNativeJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

/** Read a JSON mutation body with a 34 MiB transport limit; unsupported content types fail explicitly. */
export async function readNativeJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
    throw Object.assign(new Error('Use application/json for API mutations'), { status: 415 });
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 34 * 1024 * 1024) throw Object.assign(new Error('Request size limit exceeded'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid request JSON'); }
}
