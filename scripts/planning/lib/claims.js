import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const TASK_ID = /^SF-(?:A\d{2}|R\d{3})-[TB]\d{2}(?:\.\d+)?$/;
export function agentId(value) {
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){1,8}$/.test(value ?? '') || value.length > 80) throw new Error('Agent ID must be 3..80 lowercase characters, with a namespace separator');
  return value;
}
export function taskId(item) {
  const task = item.content.title.match(/^\[(SF-[^\]]+)\]/)?.[1];
  if (!TASK_ID.test(task ?? '')) throw new Error('Only task/bug leaves can be claimed'); return task;
}
export const claimRef = task => `agent/${task}`;
export const operationRef = task => `agent-ops/${task}`;
export const lockRef = key => `agent-locks/${key}`;
export const auditBody = record => `<!-- sharpforge-agent-event:v1 -->\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``;
export function auditRecord(comment) {
  if (!comment.body?.startsWith('<!-- sharpforge-agent-event:v1 -->')) return null;
  try { return JSON.parse(comment.body.match(/```json\s*([\s\S]*?)```/)?.[1]); } catch { return null; }
}

export class Claims {
  constructor(client, { now = () => new Date(), uuid = randomUUID, locks } = {}) {
    this.client = client; this.now = now; this.uuid = uuid;
    this.locks = locks ?? JSON.parse(readFileSync(new URL('../../../planning/contracts/locks.json', import.meta.url)));
  }
  expires(ttlHours) {
    const hours = Number(ttlHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 168) throw new Error('Lease TTL must be >0 and <=168 hours');
    return new Date(this.now().getTime() + hours * 3600000).toISOString();
  }
  async state(issue) {
    const item = await this.client.item(issue), task = taskId(item), ref = await this.client.ref(claimRef(task));
    return { item, task, ref, record: ref ? await this.client.readRecord(ref.object.sha) : null };
  }
  async exclusive(state, fn) {
    const expectedGeneration = state.record?.generation;
    if (typeof expectedGeneration !== 'string' || !expectedGeneration) {
      throw new Error(`Task ${state.task} has no valid claim generation; manual reconciliation required`);
    }
    const mutex = operationRef(state.task);
    try { await this.client.createRef(mutex, state.ref.object.sha); }
    catch (error) { if (error.status === 422) throw new Error(`Task ${state.task} is busy; an interrupted operation requires manual reconciliation`); throw error; }
    try {
      const current = await this.state(state.item.content.number);
      // A release/reclaim can finish between the initial read and mutex creation.
      // Ref names and agent IDs may repeat; the immutable generation must not.
      if (current.task !== state.task || current.record?.generation !== expectedGeneration) {
        throw new Error(`Task ${state.task} claim generation changed or was released; inspect current ownership before retrying`);
      }
      return await fn(current);
    }
    finally { await this.client.deleteRef(mutex); }
  }
  owner(state, agent, { allowExpired = false } = {}) {
    agentId(agent);
    if (!state.record || state.record.agent !== agent) throw new Error(`Task ${state.task} belongs to ${state.record?.agent ?? state.item.fields.Agent ?? 'nobody'}`);
    if (!allowExpired && Date.parse(state.record.expires) <= this.now().getTime()) throw new Error('Lease expired; explicit reconcile/release required');
  }
  async persist(state, updates) {
    const record = { ...state.record, ...updates, sequence: state.record.sequence + 1, at: this.now().toISOString() };
    const sha = await this.client.writeRecord(record, state.ref.object.sha);
    await this.client.updateRef(claimRef(state.task), sha);
    state.record = record; state.ref.object.sha = sha; return record;
  }
  async log(state, event, extra = {}) {
    const record = { version: 1, task: state.task, issue: state.item.content.number, agent: state.record.agent, generation: state.record.generation, sequence: state.record.sequence, at: this.now().toISOString(), event, ...extra };
    await this.client.comment(state.item.content.number, auditBody(record)); return record;
  }
  async claim({ issue, agent, branch, ttlHours = 24, ready }) {
    agentId(agent); const expires = this.expires(ttlHours);
    if (!branch || branch.length > 200 || !/^[\w./-]+$/.test(branch) || /\.\.|\/\.|\.lock$|\/$|\/\//.test(branch) || /^(?:agent|agent-ops|agent-locks)\//.test(branch)) throw new Error('Invalid implementation branch; reserved lock namespaces cannot contain product code');
    const state = await this.state(issue);
    if (state.record || state.item.fields.Agent) throw new Error(`Task ${state.task} already owned; expiry never authorizes takeover`);
    if (state.item.content.state !== 'OPEN') throw new Error('Cannot claim a closed issue');
    const children = await this.client.api('GET', `issues/${issue}/sub_issues?per_page=1`);
    if (children.length) throw new Error('Cannot claim a task with sub-issues');
    if (state.item.fields.Status !== 'Ready') throw new Error(`Task ${state.task} is not Ready`);
    if (ready) await ready(state.item);
    // The successful create is the ownership linearization point. Losing claimants never modify fields.
    const record = { version: 1, task: state.task, issue: Number(issue), agent, branch, expires, heartbeat: this.now().toISOString(), lastHeartbeatComment: null, locks: [], generation: this.uuid(), sequence: 0, event: 'claim', at: this.now().toISOString() };
    const sha = await this.client.writeRecord(record);
    try { await this.client.createRef(claimRef(state.task), sha); }
    catch (error) { if (error.status === 422) throw new Error(`Task ${state.task} already claimed by another agent`); throw error; }
    state.ref = { object: { sha } }; state.record = record;
    await this.client.setFields(state.item, { Agent: agent, 'Lease expires': expires.slice(0, 10), Branch: branch, 'Lock keys': null, Status: 'Claimed' });
    await this.client.label(issue, 'agent:claimed'); await this.log(state, 'claim', { branch, expires }); return record;
  }
  async heartbeat({ issue, agent, ttlHours = 24 }) {
    const expires = this.expires(ttlHours), initial = await this.state(issue); this.owner(initial, agent);
    return this.exclusive(initial, async state => {
      this.owner(state, agent);
      const at = this.now().toISOString(), shouldComment = !state.record.lastHeartbeatComment || this.now().getTime() - Date.parse(state.record.lastHeartbeatComment) >= 3600000;
      await this.persist(state, { event: 'heartbeat', expires: new Date(Math.max(Date.parse(expires), Date.parse(state.record.expires))).toISOString(), heartbeat: at });
      await this.client.setFields(state.item, { 'Lease expires': state.record.expires.slice(0, 10) });
      const recentComment = shouldComment && (await this.client.comments(issue)).some(comment => { const event = auditRecord(comment); return event?.event === 'heartbeat' && event.generation === state.record.generation && this.now().getTime() - Date.parse(event.at) < 3600000; });
      if (shouldComment && !recentComment) {
        await this.log(state, 'heartbeat', { expires: state.record.expires });
        await this.persist(state, { lastHeartbeatComment: at });
      }
      return state.record;
    });
  }
  async lock({ issue, agent, key, release = false }) {
    if (!Object.hasOwn(this.locks, key)) throw new Error(`Unknown lock key: ${key}`);
    const initial = await this.state(issue); this.owner(initial, agent);
    return this.exclusive(initial, async state => {
      this.owner(state, agent); const name = lockRef(key), existing = await this.client.ref(name);
      if (release) {
        if (existing) {
          const held = await this.client.readRecord(existing.object.sha);
          if (held.generation !== state.record.generation) throw new Error(`Lock ${key} belongs to ${held.task}/${held.agent}`);
        }
        await this.persist(state, { event: 'unlock', locks: state.record.locks.filter(k => k !== key) });
        await this.client.setFields(state.item, { 'Lock keys': state.record.locks.join(', ') || null });
        if (existing) await this.client.deleteRef(name);
        await this.log(state, 'unlock', { key });
      } else {
        if (existing) {
          const held = await this.client.readRecord(existing.object.sha);
          if (held.generation !== state.record.generation) throw new Error(`Lock ${key} belongs to ${held.task}/${held.agent}`);
        } else {
          try { await this.client.createRef(name, state.ref.object.sha); }
          catch (error) {
            if (error.status !== 422) throw error;
            const winner = await this.client.ref(name), held = await this.client.readRecord(winner.object.sha);
            throw new Error(`Lock ${key} belongs to ${held.task}/${held.agent}`);
          }
        }
        await this.persist(state, { event: 'lock', locks: [...new Set([...state.record.locks, key])].sort() });
        await this.client.setFields(state.item, { 'Lock keys': state.record.locks.join(', ') });
        await this.log(state, 'lock', { key });
      }
      return state.record;
    });
  }
  async release({ issue, agent, reconcile = false, reason, handoff }) {
    agentId(agent); const initial = await this.state(issue);
    if (!initial.record) throw new Error('No managed claim exists; legacy field-only claims require manual reconciliation');
    if (initial.record.agent !== agent && !reconcile) throw new Error(`Task belongs to ${initial.record.agent}; non-owner release requires --reconcile`);
    if (reconcile && !reason?.trim()) throw new Error('Reconciliation requires an audit reason');
    return this.exclusive(initial, async state => {
      if (state.record.agent !== agent && !reconcile) throw new Error('Claim owner changed');
      // Discover orphan locks too: a failed field update must not leak an unrecorded lock.
      for (const key of Object.keys(this.locks)) {
        const ref = await this.client.ref(lockRef(key));
        if (ref && (await this.client.readRecord(ref.object.sha)).generation === state.record.generation) await this.client.deleteRef(lockRef(key));
      }
      await this.persist(state, { event: 'release', locks: [] });
      await this.log(state, 'release', { actor: agent, reconcile, reason: reason ?? null, handoff: handoff ?? null, branch: state.record.branch });
      await this.client.setFields(state.item, { Agent: null, 'Lease expires': null, 'Lock keys': null, Branch: handoff ? state.record.branch : null, Status: 'Ready' });
      await this.client.removeLabel(issue, 'agent:claimed'); await this.client.removeLabel(issue, 'lease:expired');
      await this.client.removeLabel(issue, 'status:blocked');
      await this.client.deleteRef(claimRef(state.task));
      return { task: state.task, released: true, branchPreserved: state.record.branch };
    });
  }
  async reap() {
    const expired = [];
    // Claim refs remain authoritative even if the very first Project field write failed.
    const managed = new Map((await this.client.matchingRefs('agent/')).map(ref => [ref.ref.replace(/^refs\/heads\//, ''), ref]));
    for (const item of await this.client.items()) {
      let task; try { task = taskId(item); } catch (error) { if (item.fields.Agent) expired.push({ issue: item.content.number, error: error.message }); continue; }
      const ref = managed.get(claimRef(task));
      if (!ref && !item.fields.Agent) continue;
      let state; try { state = { item, task, ref, record: ref ? await this.client.readRecord(ref.object.sha) : null }; } catch (error) { expired.push({ issue: item.content.number, error: error.message }); continue; }
      const expiry = state.record?.expires ?? `${item.fields['Lease expires']}T23:59:59.999Z`;
      if (!Number.isFinite(Date.parse(expiry))) { expired.push({ task: state.task, error: 'Missing or invalid lease expiry; manual reconciliation required' }); continue; }
      if (Date.parse(expiry) > this.now().getTime()) continue;
      const row = { task: state.task, issue: item.content.number, agent: state.record?.agent ?? item.fields.Agent, expires: expiry, heartbeat: state.record?.heartbeat ?? null, locks: state.record?.locks ?? item.fields['Lock keys'] ?? [], branch: state.record?.branch ?? item.fields.Branch };
      const inspect = async fresh => {
        if (fresh.record && Date.parse(fresh.record.expires) > this.now().getTime()) return;
        const head = row.branch ? await this.client.ref(row.branch) : null; row.head = head?.object.sha ?? null;
        await this.client.label(item.content.number, 'lease:expired');
        const marker = `<!-- sharpforge-expired:${state.task}:${expiry} -->`;
        if (!(await this.client.comments(item.content.number)).some(c => c.body.startsWith(marker))) await this.client.comment(item.content.number, `${marker}\nLease expired; ownership retained until explicit reconciliation.\n\n\`\`\`json\n${JSON.stringify(row, null, 2)}\n\`\`\``);
        expired.push(row);
      };
      if (state.record) await this.exclusive(state, inspect); else await inspect(state);
    }
    return expired;
  }
}
