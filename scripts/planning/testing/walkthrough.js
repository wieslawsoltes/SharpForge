import { FakeGitHub } from './fake-github.js';
import { GitHubProject } from '../lib/github-project.js';
import { Claims } from '../lib/claims.js';
import { reconstructAudit } from '../audit.js';
const fake = new FakeGitHub(), claims = new Claims(new GitHubProject({ owner: 'test', transport: fake.transport }));
const task = { issue: 1, agent: 'codex-walkthrough', branch: 'codex/SF-A00-T07.3' };
await claims.claim(task); await claims.lock({ ...task, key: 'studio' }); await claims.heartbeat(task);
await claims.lock({ ...task, key: 'studio', release: true }); await claims.release(task);
console.log(JSON.stringify(reconstructAudit(fake.issues[0].comments), null, 2));
