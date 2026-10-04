import { GitError } from '../errors.js';
import { detectGitProvider } from '../origins.js';
import { secureUrl } from '../auth/security.js';

const segment = value => encodeURIComponent(value);
const configurations = {
  github(url, parts) {
    if (parts.length !== 2) throw new GitError('Unsafe', 'GitHub remote must name an owner and repository');
    return { baseUrl: url.hostname === 'github.com' ? 'https://api.github.com/' : `${url.origin}/api/v3/`,
      graphqlUrl: url.hostname === 'github.com' ? 'https://api.github.com/graphql' : `${url.origin}/api/graphql`,
      repoPath: `repos/${parts.map(segment).join('/')}`, owner: parts[0], repository: parts[1] };
  },
  gitlab(url, parts) {
    if (parts.length < 2) throw new GitError('Unsafe', 'GitLab remote must name a namespace and project');
    return { baseUrl: `${url.origin}/api/v4/`, repoPath: `projects/${segment(parts.join('/'))}`,
      owner: parts.slice(0, -1).join('/'), repository: parts.at(-1) };
  },
  bitbucket(url, parts) {
    if (url.hostname !== 'bitbucket.org' || parts.length !== 2) throw new GitError('Unsupported', 'Only Bitbucket Cloud API is supported');
    return { baseUrl: 'https://api.bitbucket.org/2.0/', repoPath: `repositories/${parts.map(segment).join('/')}`,
      owner: parts[0], repository: parts[1] };
  },
  azure(url, parts) {
    let organization;
    if (url.hostname === 'dev.azure.com') organization = parts.shift();
    else if (url.hostname.endsWith('.visualstudio.com')) organization = url.hostname.slice(0, -'.visualstudio.com'.length);
    else throw new GitError('Unsupported', 'Unsupported Azure DevOps host');
    if (!organization || parts.length !== 3 || parts[1] !== '_git') throw new GitError('Unsafe', 'Invalid Azure repository remote');
    return { baseUrl: `${url.origin}/${url.hostname === 'dev.azure.com' ? `${segment(organization)}/` : ''}${segment(parts[0])}/_apis/`,
      repoPath: `git/repositories/${segment(parts[2])}`, organization, project: parts[0], repository: parts[2] };
  },
  gitea(url, parts) {
    if (parts.length !== 2) throw new GitError('Unsafe', 'Gitea remote must name an owner and repository');
    return { baseUrl: `${url.origin}/api/v1/`, repoPath: `repos/${parts.map(segment).join('/')}`,
      owner: parts[0], repository: parts[1] };
  }
};

/** Resolve only documented provider API roots. Self-hosted services require an explicit provider kind. */
export function providerEndpoint(remote, { provider = detectGitProvider(remote) } = {}) {
  const url = secureUrl(remote, { protocols: ['https:'] });
  if (url.search) throw new GitError('Unsafe', 'Repository remote must not contain a query');
  const parts = url.pathname.replace(/\.git\/?$/, '').split('/').filter(Boolean).map(part => {
    let value;
    try { value = decodeURIComponent(part); } catch { throw new GitError('Unsafe', 'Invalid repository path encoding'); }
    if (!value || /[\u0000-\u0020/\\?#]/.test(value) || value === '.' || value === '..') {
      throw new GitError('Unsafe', 'Invalid repository path segment');
    }
    return value;
  });
  const resolver = configurations[provider];
  if (!resolver) throw new GitError('Unsupported', 'Select a supported Git hosting provider');
  return Object.freeze({ provider, remote: url.href, ...resolver(url, parts) });
}

export function apiQuery(path, values = {}) {
  const query = new URLSearchParams(Object.entries(values).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]));
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}

export function providerNumber(value) {
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new GitError('Unsafe', 'Positive issue or PR number required');
  return Number(value);
}

export function providerText(value, name = 'Provider text', maximum = 65536) {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) throw new GitError('Unsafe', `${name} is invalid`);
  return value;
}
