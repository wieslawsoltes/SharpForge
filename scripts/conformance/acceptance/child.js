import { spawn } from 'node:child_process';
import {
  ProtocolMessageReader,
  encodeProtocolMessage,
} from '../../../packages/protocol/src/index.js';
/** One owned local process; requests are bounded and cancellation kills its process tree. */
export class Child {
  constructor(command, args, { cwd, env = process.env, dap = false } = {}) {
    this.child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    this.dap = dap;
    this.sequence = 0;
    this.termination = Promise.resolve();
    this.pending = new Map();
    this.events = [];
    this.stderr = '';
    this.bytes = 0;
    this.buffer = '';
    this.reader = dap ? new ProtocolMessageReader() : null;
    this.child.stdout.on('data', (chunk) => {
      try {
        this.bytes += chunk.length;
        if (this.bytes > 32 * 1024 * 1024)
          throw new Error('Adapter output limit exceeded');
        if (dap)
          for (const message of this.reader.feed(chunk)) this.receive(message);
        else {
          this.buffer += chunk.toString('utf8');
          let end;
          while ((end = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, end);
            this.buffer = this.buffer.slice(end + 1);
            if (line) this.receive(JSON.parse(line));
          }
        }
      } catch (error) {
        this.fail(error);
        this.kill();
      }
    });
    this.child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-65536);
    });
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', (code, signal) =>
      this.fail(new Error(`Adapter exited ${code ?? signal}: ${this.stderr}`)),
    );
    this.closed = new Promise((done) => this.child.once('close', done));
  }
  receive(message) {
    if (message.type === 'event') {
      if (this.events.length >= 10000)
        throw new Error('Adapter event limit exceeded');
      this.events.push(message);
      return;
    }
    const id = this.dap ? message.request_seq : message.id,
      pending = this.pending.get(id);
    if (!pending) throw new Error('Unexpected adapter response');
    this.pending.delete(id);
    if (message.success === false || message.error)
      pending.reject(new Error(message.message ?? message.error));
    else pending.resolve(this.dap ? message.body : message.result);
  }
  fail(error) {
    this.failure = error;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }
  async request(command, args = {}, { signal, timeout = 30000 } = {}) {
    if (signal?.aborted) throw new Error('Cancelled');
    if (this.failure) throw this.failure;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const cancel = () => {
        this.fail(
          new Error(
            signal?.aborted ? 'Cancelled' : 'Adapter request timed out',
          ),
        );
        this.kill();
      };
      const timer = setTimeout(cancel, timeout);
      const finish = (fn) => (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        fn(value);
      };
      this.pending.set(id, {
        resolve: finish(resolve),
        reject: finish(reject),
      });
      signal?.addEventListener('abort', cancel, { once: true });
      const message = this.dap
        ? { seq: id, type: 'request', command, arguments: args }
        : { id, command, args };
      this.child.stdin.write(
        this.dap
          ? encodeProtocolMessage(message)
          : JSON.stringify(message) + '\n',
      );
    });
  }
  async event(name, options = {}) {
    const deadline = Date.now() + (options.timeout ?? 30000);
    while (Date.now() < deadline) {
      if (options.signal?.aborted) throw new Error('Cancelled');
      if (this.failure) throw this.failure;
      const index = this.events.findIndex((e) => e.event === name);
      if (index >= 0) return this.events.splice(index, 1)[0].body;
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error('Timed out waiting for DAP ' + name);
  }
  kill() {
    if (!this.child.pid) return;
    if (process.platform === 'win32') {
      this.termination = new Promise((done) => {
        const killer = spawn(
          'taskkill',
          ['/pid', String(this.child.pid), '/t', '/f'],
          { stdio: 'ignore' },
        );
        killer.on('error', () => {
          this.child.kill('SIGKILL');
          done();
        });
        killer.on('close', done);
      });
    } else {
      try {
        process.kill(-this.child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') this.child.kill('SIGKILL');
      }
    }
  }
  async close() {
    this.kill();
    await this.termination;
    await this.closed;
  }
}
