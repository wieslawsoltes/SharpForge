/** Bounded GitHub API transport. Tokens never leave api.github.com or enter reports. */
export function github({ token = process.env.GH_TOKEN, fetcher = fetch, signal } = {}) {
  return async (path, { method = 'GET', body } = {}) => {
    signal?.throwIfAborted();
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')) throw new Error('Invalid GitHub API path');
    const response = await fetcher('https://api.github.com' + path, {
      method,
      redirect: 'error',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      throw Object.assign(new Error(`GitHub request failed: ${response.status} ${method} ${path}`), { status: response.status });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) throw new Error('GitHub response exceeds eight MiB');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
}

export function repositoryPath(value = process.env.GITHUB_REPOSITORY) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(value ?? '')) throw new Error('Expected repository owner/name');
  return '/repos/' + value;
}

export async function pages(api, path, { limit = 20, signal } = {}) {
  const rows = [];
  for (let page = 1; page <= limit; page++) {
    signal?.throwIfAborted();
    const batch = await api(path + (path.includes('?') ? '&' : '?') + `per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Expected paginated GitHub array');
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  throw new Error('GitHub pagination bound exceeded');
}
