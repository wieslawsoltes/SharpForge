import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { run } from '../repro/common.js';
import { within } from './scenario.js';
import { Child } from './child.js';
export class CliAdapter {
  constructor({ root, workspace }) {
    this.root = root;
    this.workspace = workspace;
  }
  async command(args, options) {
    return run(
      process.execPath,
      [join(this.root, 'apps/cli/main.js'), ...args],
      { cwd: this.workspace, ...options },
    );
  }
  async step(step, options) {
    const file = (path) => within(this.workspace, path);
    if (step.action === 'open') {
      await cp(
        join(this.root, 'tests/conformance/acceptance/fixtures', step.fixture),
        this.workspace,
        { recursive: true },
      );
      this.entry = step.entry;
      this.startup = step.startup;
      const result = await this.command(
        ['project-info', file(this.entry), '--root', this.workspace],
        options,
      );
      const snapshot = JSON.parse(result.stdout);
      assert.equal(snapshot.projects.length, 3);
      return snapshot;
    }
    if (step.action === 'edit') {
      const path = file(step.path),
        text = await readFile(path, 'utf8');
      assert.equal(
        text.split(step.find).length,
        2,
        'Edit must match exactly once',
      );
      await writeFile(path, text.replace(step.find, step.replace));
      return { path: step.path };
    }
    if (step.action === 'build') {
      await mkdir(join(this.workspace, 'out'), { recursive: true });
      this.assembly = join(this.workspace, 'out/app.dll');
      return this.command(
        [
          'compile',
          file(this.entry),
          '--root',
          this.workspace,
          '--project',
          this.startup,
          '-o',
          this.assembly,
        ],
        options,
      );
    }
    if (step.action === 'breakpoints') {
      this.points = step.points;
      return { points: this.points };
    }
    if (step.action === 'debug') {
      this.dap = new Child(
        process.execPath,
        [join(this.root, 'packages/protocol/bin/sharpforge-dap.js')],
        { cwd: this.root, dap: true },
      );
      await this.dap.request(
        'initialize',
        { adapterID: 'sharpforge-acceptance' },
        options,
      );
      await this.dap.request(
        'launch',
        {
          program: this.assembly,
          managedIL: true,
          stopOnEntry: false,
          maxInstructions: 100000,
        },
        options,
      );
      for (const point of this.points ?? []) {
        const result = await this.dap.request(
          'setBreakpoints',
          { source: { path: point.path }, breakpoints: [{ line: point.line }] },
          options,
        );
        assert(
          result.breakpoints.every((b) => b.verified),
          JSON.stringify(result),
        );
      }
      await this.dap.request('configurationDone', {}, options);
      return this.stopped(step, options);
    }
    if (step.action === 'step' || step.action === 'continue') {
      this.dap.events = this.dap.events.filter((e) => e.event !== 'stopped');
      await this.dap.request(
        step.action === 'step' ? step.kind : 'continue',
        { threadId: this.threadId },
        options,
      );
      if (step.output !== undefined) {
        await this.dap.event('terminated', options);
        const output = this.dap.events
          .filter((e) => e.event === 'output')
          .map((e) => e.body.output)
          .join('');
        assert.equal(output.trim(), step.output);
        return { output };
      }
      return this.stopped(step, options);
    }
    if (step.action === 'inspect') {
      const result = await this.dap.request(
        'evaluate',
        {
          expression: step.expression,
          frameId: this.frame.id,
          context: 'watch',
        },
        options,
      );
      assert.equal(result.result, step.equals);
      return result;
    }
    throw new Error('CLI action unavailable: ' + step.action);
  }
  async stopped(step, options) {
    const stopped = await this.dap.event('stopped', options);
    this.threadId = stopped.threadId;
    const stack = await this.dap.request(
      'stackTrace',
      { threadId: this.threadId },
      options,
    );
    this.frame = stack.stackFrames[0];
    if (step.path) assert.equal(this.frame.source.path, step.path);
    if (step.line) assert.equal(this.frame.line, step.line);
    const scopes = await this.dap.request(
      'scopes',
      { frameId: this.frame.id },
      options,
    );
    const locals = await this.dap.request(
      'variables',
      { variablesReference: scopes.scopes[0].variablesReference },
      options,
    );
    return { stopped, stack, locals };
  }
  async close() {
    if (this.dap) await this.dap.close();
  }
}
