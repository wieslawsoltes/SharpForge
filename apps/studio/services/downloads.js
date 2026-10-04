/** The single download boundary applies registered filters before allocating a browser URL. */
export async function downloadStudioArtifact(host, name, content, mimeType, { signal } = {}) {
  const document = host.document ?? globalThis.document;
  const urls = host.urls ?? globalThis.URL;
  const schedule = host.schedule ?? globalThis.setTimeout;
  let url;
  try {
    signal?.throwIfAborted();
    mimeType ??= /\.json$/i.test(name) ? 'application/json' : typeof content === 'string' ? 'text/plain' : 'application/octet-stream';
    const artifact = await host.artifacts.prepare({ name, content, mimeType, signal });
    signal?.throwIfAborted();
    url = urls.createObjectURL(new Blob([artifact.bytes], { type: artifact.mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = artifact.name;
    signal?.throwIfAborted();
    link.click();
    schedule(() => urls.revokeObjectURL(url), 1000);
    return artifact;
  } catch (error) {
    if (url) urls.revokeObjectURL(url);
    host.onError?.(error);
    return null;
  }
}
