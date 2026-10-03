# @sharpforge/network — 0.14.0

Explicit-origin HTTP and WebSocket clients, with bounded queues, deadlines, byte limits and cancellation. Networking is denied until the embedding host supplies an origin capability. This package is separate from the SharpForge compiler and VM.

```js
import {HttpTransport, NetworkPolicy, WebSocketClient, createBrowserCsp} from '@sharpforge/network';
const policy = new NetworkPolicy({allowedOrigins:['http://127.0.0.1:8787'], maxResponseBytes:1048576});
const http = new HttpTransport(policy);
try {
  const response = await http.request('http://127.0.0.1:8787/data', {signal: AbortSignal.timeout(5000)});
  console.log(response.status, response.text);
} finally { http.dispose(); }
```

`NetworkPolicy` accepts exact http/https/ws/wss origins only: no credentials, paths, queries, fragments, wildcards or prefix matching. Defaults: 1 MiB request and response, 10 seconds deadline, four active HTTP requests, 32 queued requests. Configurable caps: 64 MiB/body, ten minutes, 32 active, 1024 queued, 100 origins. Unknown options do not create a grant. Host code is trusted to choose origins; granting an origin permits paths on that origin, not just the example endpoint. This is not DNS pinning or an SSRF firewall for arbitrary native applications.

`HttpTransport.request(url,{baseAddress,method,headers,body,signal,timeoutMs})` accepts GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS. Body is null, string or Uint8Array. Bodies are copied and bounded before queuing; GET/HEAD bodies are rejected. Responses are buffered with a streaming byte cap, then expose status/statusText/ok/url/headers/bytes/text. HTTP error status is returned as data. Header filtering rejects Cookie/Host/Origin/Referer/Connection/Content-Length/Transfer-Encoding and proxy/security headers. Fetch uses credentials omit, redirect error and no-referrer. Set-Cookie is not exposed. Explicit authorization headers remain possible for granted endpoints. CORS, mixed-content and administrator CSP still apply. There is no proxy, TLS validation override, credential store, automatic retry or arbitrary socket connection.

`WebSocketClient(policy,{maxMessageBytes,maxQueuedMessages})`: `await connect(url,{protocols,signal})`, `send(string|Uint8Array)`, `await receive({signal,timeoutMs})`, `close(code,reason)`. Frames, send buffering and receive queues are bounded; receive returns null at orderly close. Connections are one-use. Browser WebSocket cookie behavior is controlled by the browser and cannot be disabled with Fetch's credentials option; grant WS origins accordingly. Custom authentication headers are not supplied. In 0.14 this API is JavaScript-only: it is not a managed System.Net.WebSockets.ClientWebSocket implementation.

`createBrowserCsp(origins=[])` returns a policy for the static/native IDE host, permitting its local scripts/styles, WASM, Blob workers, and only self plus exact administrator-provided connection origins. Server CSP and managed session grants are independent checks; neither bypasses the other. A policy here cannot override a stricter enclosing browser/extension policy.

Requires Node >=22 with Fetch/WebSocket or a modern browser. Tests make actual local HTTP requests and exchange actual text/binary WebSocket frames. No networking is performed just by importing the package or opening a project. See the repository's language/runtime/networking guide for managed HttpClient integration and reverse-debugger boundaries.
