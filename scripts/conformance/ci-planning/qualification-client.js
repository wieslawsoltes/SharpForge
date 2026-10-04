import {spawn} from 'node:child_process';
import {GitHubProject} from '../../planning/lib/github-project.js';
import {ghTransport, isReadOnlyRequest} from '../../planning/lib/gh-retry.js';

/** Candidate-controlled qualification commands do not inherit API credentials. */
export function qualificationEnvironment(environment = process.env) {
  const result = {...environment};
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'PROJECT_READ_TOKEN']) delete result[name];
  return result;
}

/** Project GraphQL and repository reads use separate, explicitly configured credentials. */
export function planningClient(environment = process.env, {spawnProcess = spawn} = {}) {
  if (!environment.GH_TOKEN || !environment.PROJECT_READ_TOKEN) {
    throw new Error('Planning qualification requires GH_TOKEN and read-only PROJECT_READ_TOKEN (PLANNING_PROJECT_READ_TOKEN secret)');
  }
  const transport = token => ghTransport({spawnProcess: (command, args, options) => spawnProcess(command, args, {
    ...options, env: {...qualificationEnvironment(environment), GH_TOKEN: token},
  })});
  const project = transport(environment.PROJECT_READ_TOKEN), repository = transport(environment.GH_TOKEN);
  const [owner, repo] = (environment.GITHUB_REPOSITORY ?? '').split('/');
  return new GitHubProject({owner, repo, transport: request => {
    if (!isReadOnlyRequest(request)) throw new Error('Planning qualification credentials permit read-only requests');
    return request.path === 'graphql' ? project(request) : repository(request);
  }});
}
