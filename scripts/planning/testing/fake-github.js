import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { GitHubError } from '../lib/gh-retry.js';

const clone = value => structuredClone(value);
export class FakeGitHub {
  constructor({ count = 1, seed = 1, latency = false } = {}) {
    this.seed = seed; this.latency = latency; this.requests = []; this.failures = []; this.refs = new Map(); this.objects = new Map(); this.commentId = 0;
    this.fields = ['Agent', 'Lease expires', 'Branch', 'Lock keys', 'Status'].map((name, i) => ({ id: `field-${i}`, name, dataType: name === 'Status' ? 'SINGLE_SELECT' : name === 'Lease expires' ? 'DATE' : 'TEXT', ...(name === 'Status' ? { options: ['Backlog', 'Ready', 'Claimed', 'In progress', 'In review', 'Blocked', 'Done'].map((name, i) => ({ id: `status-${i}`, name })) } : {}) }));
    this.issues = Array.from({ length: count }, (_, i) => ({ id: `item-${i + 1}`, content: { id: `issue-${i + 1}`, number: i + 1, title: `[SF-A00-T07.${i + 1}] Fixture`, state: 'OPEN', body: '', repository: { nameWithOwner: 'test/SharpForge' } }, fields: { Status: 'Ready' }, children: [], labels: [], comments: [] }));
    this.transport = this.transport.bind(this);
  }
  error(status, message, headers) { throw new GitHubError(message, { status, headers }); }
  object(data) { const sha = createHash('sha1').update(JSON.stringify(data)).digest('hex'); this.objects.set(sha, clone(data)); return { sha }; }
  page(nodes, cursor, size) {
    const offset = Number(cursor ?? 0); return { nodes: clone(nodes.slice(offset, offset + size)), pageInfo: { hasNextPage: offset + size < nodes.length, endCursor: String(offset + size) } };
  }
  async transport(request) {
    this.requests.push(clone(request));
    if (this.latency) { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; await new Promise(resolve => setTimeout(resolve, this.seed % 3)); }
    const failure = this.failures.find(f => f.remaining > 0 && f.match(request));
    if (failure) { failure.remaining--; this.error(failure.status, failure.message, failure.headers); }
    const { method = 'GET', path, body } = request;
    if (path === 'graphql') {
      const { query, variables: v } = body;
      if (/query Project\(/.test(query)) return { data: { user: { projectV2: { id: 'project-4', title: 'Fixture' } } } };
      if (/query Fields\(/.test(query)) return { data: { node: { fields: this.page(this.fields, v.after, 50) } } };
      if (/query Items\(/.test(query)) return { data: { node: { items: this.page(this.issues.map(i => ({ id: i.id, content: i.content, fieldValues: { nodes: Object.entries(i.fields).map(([name, value]) => ({ field: { name }, ...(name === 'Status' ? { name: value } : name === 'Lease expires' ? { date: value } : { text: value }) })) } })), v.after, 50) } } };
      const item = this.issues.find(i => i.id === v.item), field = this.fields.find(f => f.id === v.field);
      if (/mutation (?:Set|Clear)\(/.test(query)) {
        if (!item || !field) return { errors: [{ message: 'Unknown field or item' }] };
        if (/mutation Clear\(/.test(query)) delete item.fields[field.name];
        else item.fields[field.name] = v.value.singleSelectOptionId ? field.options.find(o => o.id === v.value.singleSelectOptionId)?.name : v.value.text ?? v.value.date ?? v.value.number;
        return { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: item.id } } } };
      }
      throw new Error(`Unsupported GraphQL: ${query}`);
    }
    const suffix = path.replace(/^repos\/[^/]+\/[^/]+\//, '');
    if (method === 'POST' && suffix === 'git/refs') {
      if (this.refs.has(body.ref)) this.error(422, 'Reference already exists');
      if (!this.objects.has(body.sha)) this.error(422, 'Unknown commit');
      this.refs.set(body.ref, body.sha); return { ref: body.ref, object: { sha: body.sha } };
    }
    if (method === 'GET' && suffix.startsWith('git/matching-refs/')) {
      const prefix = 'refs/' + suffix.slice('git/matching-refs/'.length);
      return [...this.refs].filter(([name]) => name.startsWith(prefix)).map(([ref, sha]) => ({ref, object: {sha}}));
    }
    const refMatch = suffix.match(/^git\/(?:ref|refs)\/(heads\/.+)$/);
    if (refMatch) {
      const key = `refs/${refMatch[1]}`, sha = this.refs.get(key);
      if (!sha) this.error(404, 'Reference not found');
      if (method === 'DELETE') { this.refs.delete(key); return null; }
      if (method === 'PATCH') {
        if (!body.force && !this.objects.get(body.sha)?.parents?.includes(sha)) this.error(422, 'Not a fast forward');
        this.refs.set(key, body.sha); return { ref: key, object: { sha: body.sha } };
      }
      return { ref: key, object: { sha } };
    }
    if (method === 'POST' && /^git\/(blobs|trees|commits)$/.test(suffix)) return this.object(body);
    const objectMatch = suffix.match(/^git\/(blobs|trees|commits)\/(\w+)$/);
    if (objectMatch) {
      const value = this.objects.get(objectMatch[2]); if (!value) this.error(404, 'Object missing');
      return clone(objectMatch[1] === 'commits' ? { ...value, tree: { sha: value.tree } } : value);
    }
    const issueMatch = suffix.match(/^issues\/(\d+)\/(sub_issues|labels|comments)(?:\/([^?]+))?(?:\?(.*))?$/);
    if (issueMatch) {
      const issue = this.issues.find(i => i.content.number === Number(issueMatch[1])); if (!issue) this.error(404, 'Issue missing');
      const [, , resource, label, query] = issueMatch, params = new URLSearchParams(query), page = Number(params.get('page') ?? 1), size = Number(params.get('per_page') ?? 100);
      if (resource === 'sub_issues') return clone(issue.children.slice(0, size));
      if (resource === 'labels') {
        if (method === 'POST') issue.labels = [...new Set([...issue.labels, ...body.labels])];
        if (method === 'DELETE') issue.labels = issue.labels.filter(l => l !== decodeURIComponent(label));
        return clone(issue.labels);
      }
      if (method === 'POST') { const comment = { id: ++this.commentId, body: body.body, created_at: new Date().toISOString() }; issue.comments.push(comment); return clone(comment); }
      return clone(issue.comments.slice((page - 1) * size, page * size));
    }
    throw new Error(`Unsupported fake route: ${method} ${path}`);
  }
  async listen() {
    const server = createServer(async (req, res) => {
      try {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const result = await this.transport({ method: req.method, path: req.url.slice(1), ...(raw ? { body: JSON.parse(raw) } : {}) });
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
      } catch (error) { res.writeHead(error.status || 500, { 'content-type': 'application/json', ...error.headers }); res.end(JSON.stringify({ message: error.message })); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())) };
  }
}
