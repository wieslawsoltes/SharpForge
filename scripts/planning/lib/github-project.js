import { ghTransport, GitHubError, withRetry } from './gh-retry.js';

export class GitHubProject {
  constructor({ owner, repo = 'SharpForge', number = 4, transport = ghTransport() }) {
    if (!/^[\w.-]+$/.test(owner ?? '') || !/^[\w.-]+$/.test(repo)) throw new Error('Invalid owner/repo');
    this.owner = owner; this.repo = repo; this.number = Number(number); this.transport = transport;
    this.base = `repos/${owner}/${repo}`;
  }
  async graphql(query, variables = {}) {
    return withRetry(async () => {
      const result = await this.transport({ method: 'POST', path: 'graphql', body: { query, variables } });
      if (result.errors?.length) {
        const message = [...new Set(result.errors.map(e => e.message))].join('; ');
        if (/resource limits|node limit|MAX_NODE_LIMIT/i.test(message)) {
          const page = query.match(/(?:items|fields)\(first:(\d+)/);
          if (page && Number(page[1]) > 1) return this.graphql(query.replace(page[0], page[0].replace(page[1], String(Math.max(1, Math.floor(Number(page[1]) / 2))))), variables);
          const error = new GitHubError(`GraphQL query exceeds resource limits: ${message}`, { data: result.errors }); error.exitCode = 65; throw error;
        }
        throw new GitHubError(message, { status: /rate limit|abuse|secondary/i.test(message) ? 403 : 0, data: result.errors });
      }
      return result.data;
    });
  }
  async project() {
    if (this.cachedProject) return this.cachedProject;
    const data = await this.graphql('query Project($owner:String!,$number:Int!){user(login:$owner){projectV2(number:$number){id title}}}', { owner: this.owner, number: this.number });
    const project = data.user?.projectV2;
    if (!project) throw new Error(`Project ${this.owner}/${this.number} not found`);
    const fields = []; let after = null;
    do {
      const page = await this.graphql('query Fields($id:ID!,$after:String){node(id:$id){... on ProjectV2{fields(first:50,after:$after){nodes{... on ProjectV2Field{id name dataType} ... on ProjectV2SingleSelectField{id name dataType options{id name}}} pageInfo{hasNextPage endCursor}}}}}', { id: project.id, after });
      const connection = page.node.fields; fields.push(...connection.nodes); after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    } while (after);
    this.cachedProject = { ...project, fields }; return this.cachedProject;
  }
  async items() {
    const project = await this.project(), items = []; let after = null;
    do {
      const data = await this.graphql('query Items($id:ID!,$after:String){node(id:$id){... on ProjectV2{items(first:50,after:$after){nodes{id content{... on Issue{id number title body state repository{nameWithOwner}}} fieldValues(first:100){nodes{... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2Field{name}}} ... on ProjectV2ItemFieldDateValue{date field{... on ProjectV2Field{name}}} ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}}}}} pageInfo{hasNextPage endCursor}}}}}', { id: project.id, after });
      const connection = data.node.items;
      for (const item of connection.nodes) {
        if (item.content?.repository?.nameWithOwner !== `${this.owner}/${this.repo}`) continue;
        items.push({ ...item, fields: Object.fromEntries(item.fieldValues.nodes.filter(v => v.field).map(v => [v.field.name, v.text ?? v.date ?? v.name])) });
      }
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    } while (after);
    return items;
  }
  async item(issue) {
    const item = (await this.items()).find(i => i.content.number === Number(issue));
    if (!item) throw new Error(`Issue #${issue} not in project`); return item;
  }
  async setFields(item, values) {
    const project = await this.project();
    for (const [name, value] of Object.entries(values)) {
      const field = project.fields.find(f => f.name === name);
      if (!field) throw new Error(`Missing project field: ${name}`);
      if (value === null) {
        await this.graphql('mutation Clear($project:ID!,$item:ID!,$field:ID!){clearProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field}){projectV2Item{id}}}', { project: project.id, item: item.id, field: field.id });
        continue;
      }
      const type = field.dataType ?? (field.options ? 'SINGLE_SELECT' : 'TEXT');
      let encoded;
      if (type === 'SINGLE_SELECT') {
        const option = field.options.find(o => o.name === value);
        if (!option) throw new Error(`Unknown option ${name}: ${value}`); encoded = { singleSelectOptionId: option.id };
      } else if (type === 'DATE') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date ${value}`); encoded = { date: value };
      } else if (type === 'NUMBER') encoded = { number: Number(value) };
      else encoded = { text: String(value) };
      await this.graphql('mutation Set($project:ID!,$item:ID!,$field:ID!,$value:ProjectV2FieldValue!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:$value}){projectV2Item{id}}}', { project: project.id, item: item.id, field: field.id, value: encoded });
    }
  }
  api(method, path, body) { return this.transport({ method, path: `${this.base}/${path}`, ...(body === undefined ? {} : { body }) }); }
  async ref(name) { try { return await this.api('GET', `git/ref/heads/${name}`); } catch (e) { if (e.status === 404) return null; throw e; } }
  createRef(name, sha) { return this.api('POST', 'git/refs', { ref: `refs/heads/${name}`, sha }); }
  updateRef(name, sha) { return this.api('PATCH', `git/refs/heads/${name}`, { sha, force: false }); }
  deleteRef(name) { return this.api('DELETE', `git/refs/heads/${name}`); }
  async pages(path) {
    const result = [];
    for (let page = 1; ; page++) { const batch = await this.api('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`); result.push(...batch); if (batch.length < 100) return result; }
  }
  comments(issue) { return this.pages(`issues/${issue}/comments`); }
  comment(issue, body) { return this.api('POST', `issues/${issue}/comments`, { body }); }
  label(issue, label) { return this.api('POST', `issues/${issue}/labels`, { labels: [label] }); }
  async removeLabel(issue, label) { try { return await this.api('DELETE', `issues/${issue}/labels/${encodeURIComponent(label)}`); } catch (e) { if (e.status !== 404) throw e; } }
  async writeRecord(record, parent) {
    const blob = await this.api('POST', 'git/blobs', { content: JSON.stringify(record), encoding: 'utf-8' });
    const tree = await this.api('POST', 'git/trees', { tree: [{ path: 'claim.json', mode: '100644', type: 'blob', sha: blob.sha }] });
    return (await this.api('POST', 'git/commits', { message: `Agent ${record.event ?? 'claim'}: ${record.task}`, tree: tree.sha, parents: parent ? [parent] : [] })).sha;
  }
  async readRecord(sha) {
    const commit = await this.api('GET', `git/commits/${sha}`), tree = await this.api('GET', `git/trees/${commit.tree.sha}`);
    const entry = tree.tree.find(e => e.path === 'claim.json');
    if (!entry) throw new Error(`Claim ref ${sha} has no claim.json; reconcile manually`);
    const blob = await this.api('GET', `git/blobs/${entry.sha}`);
    return JSON.parse(blob.encoding === 'base64' ? Buffer.from(blob.content, 'base64').toString('utf8') : blob.content);
  }
}
