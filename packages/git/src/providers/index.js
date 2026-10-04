import { ProviderClient } from './client.js';
import { providerEndpoint } from './endpoints.js';
import { GitHubProvider } from './github.js';
import { GitLabProvider } from './gitlab.js';
import { BitbucketProvider } from './bitbucket.js';
import { AzureDevOpsProvider } from './azure.js';
import { GiteaProvider } from './gitea.js';
import { GitHubTransport } from './github-transport.js';
import { GitLabTransport } from './gitlab-transport.js';
import { BitbucketTransport } from './bitbucket-transport.js';
import { AzureDevOpsTransport } from './azure-transport.js';
import { GiteaTransport } from './gitea-transport.js';

const providers = { github: GitHubProvider, gitlab: GitLabProvider, bitbucket: BitbucketProvider,
  azure: AzureDevOpsProvider, gitea: GiteaProvider };
const transports = { github: GitHubTransport, gitlab: GitLabTransport, bitbucket: BitbucketTransport,
  azure: AzureDevOpsTransport, gitea: GiteaTransport };

function configuration(options) {
  const endpoint = options.endpoint ?? providerEndpoint(options.remote, options);
  const headers = endpoint.provider === 'github' ? { 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json' } : {};
  const client = options.client ?? new ProviderClient({ ...options, baseUrl: endpoint.baseUrl, graphqlUrl: endpoint.graphqlUrl, headers });
  return { endpoint, client };
}

/** Construct a provider from an exact remote identity; clients and native Web APIs remain injectable. */
export function createGitProvider(options) {
  const config = configuration(options);
  return new providers[config.endpoint.provider](config);
}

export function createProviderTransport(options) {
  const config = configuration(options);
  return new transports[config.endpoint.provider](config);
}

export { ProviderClient } from './client.js';
export { providerEndpoint, apiQuery } from './endpoints.js';
export { ProviderTransport } from './transport.js';
export { GitHubProvider } from './github.js';
export { GitLabProvider } from './gitlab.js';
export { BitbucketProvider } from './bitbucket.js';
export { AzureDevOpsProvider } from './azure.js';
export { GiteaProvider } from './gitea.js';
export { GitHubTransport } from './github-transport.js';
export { GitLabTransport } from './gitlab-transport.js';
export { BitbucketTransport } from './bitbucket-transport.js';
export { AzureDevOpsTransport } from './azure-transport.js';
export { GiteaTransport } from './gitea-transport.js';
