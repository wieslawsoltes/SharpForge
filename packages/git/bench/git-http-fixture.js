import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

function cgiEnvironment(request, url, options) {
  const uploadPack = url.pathname.endsWith('/git-upload-pack') || url.searchParams.get('service') === 'git-upload-pack';
  // Forced fetch versions must not suppress the v0 service preamble used by native receive-pack clients.
  const protocol = uploadPack && options.protocolVersion !== undefined
    ? `version=${options.protocolVersion}` : request.headers['git-protocol'] ?? '';
  return {
    ...process.env, ...options.env, GIT_PROJECT_ROOT: options.directory, GIT_HTTP_EXPORT_ALL: '1',
    REQUEST_METHOD: request.method, PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1),
    CONTENT_TYPE: request.headers['content-type'] ?? '', CONTENT_LENGTH: request.headers['content-length'] ?? '',
    HTTP_GIT_PROTOCOL: protocol,
    // Native remote-curl gzips larger negotiation requests; http-backend inflates only when this CGI header is present.
    HTTP_CONTENT_ENCODING: request.headers['content-encoding'] ?? '',
    REMOTE_USER: 'conformance', REMOTE_ADDR: '127.0.0.1',
    GIT_TERMINAL_PROMPT: '0'
  };
}

function parseCgiHeader(bytes, response) {
  const headers = {};
  let status = 200;
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const name = line.slice(0, separator).toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === 'status') status = Number(value.split(' ')[0]);
    else headers[name] = value;
  }
  response.writeHead(status, headers);
}

function serveGit(request, response, options, children) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (!/^\/[a-zA-Z0-9._-]+\.git\/(?:info\/refs|git-upload-pack|git-receive-pack)$/.test(url.pathname)) {
    response.writeHead(404);
    response.end();
    return;
  }
  const child = spawn(options.git ?? 'git', ['http-backend'], {
    env: cgiEnvironment(request, url, options), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
  });
  children.add(child);
  let header = Buffer.alloc(0);
  let ready = false;
  let requestBytes = 0;
  let responseBytes = 0;
  const fail = () => { child.kill('SIGKILL'); response.destroy(); };
  const timer = setTimeout(fail, options.timeoutMs ?? 120_000);
  child.on('error', fail);
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') fail(); });
  child.stderr.resume();
  request.on('data', bytes => {
    requestBytes += bytes.length;
    if (requestBytes > (options.maxRequestBytes ?? 256 * 1024 * 1024)) fail();
  });
  request.on('aborted', fail);
  request.pipe(child.stdin);
  child.stdout.on('data', bytes => {
    responseBytes += bytes.length;
    if (responseBytes > (options.maxResponseBytes ?? 4 * 1024 * 1024 * 1024)) { fail(); return; }
    if (!ready) {
      header = Buffer.concat([header, bytes]);
      let separator = header.indexOf('\r\n\r\n');
      let length = 4;
      if (separator < 0) { separator = header.indexOf('\n\n'); length = 2; }
      if (separator < 0) { if (header.length > 65536) fail(); return; }
      parseCgiHeader(header.subarray(0, separator), response);
      bytes = header.subarray(separator + length);
      header = null;
      ready = true;
    }
    if (!response.write(bytes)) child.stdout.pause();
  });
  response.on('drain', () => child.stdout.resume());
  response.on('close', () => { if (!response.writableEnded) child.kill('SIGKILL'); });
  child.on('close', code => {
    clearTimeout(timer);
    children.delete(child);
    if (code || !ready) response.destroy();
    else response.end();
  });
}

/** Local-only native Git smart-HTTP fixture shared by conformance and standalone benchmarks. */
export async function startGitHttpFixture(options) {
  if (options.protocolVersion !== undefined && ![0, 1, 2].includes(options.protocolVersion)) {
    throw new RangeError('Fixture protocolVersion must be 0, 1 or 2');
  }
  const children = new Set();
  const server = createServer((request, response) => serveGit(request, response, options, children));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      for (const child of children) child.kill('SIGKILL');
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    })
  };
}
