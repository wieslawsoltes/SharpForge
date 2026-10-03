import { join } from 'node:path';
import { Child } from './child.js';
export class StudioAdapter {
  constructor({ root, output }) {
    this.root = root;
    this.output = output;
  }
  start() {
    const { root, output } = this;
    this.child = new Child(
      process.env.PYTHON ?? 'python3',
      [join(root, 'scripts/conformance/acceptance/studio-driver.py'), output],
      {
        cwd: root,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          SHARPFORGE_RESULTS_DIR: output,
          SHARPFORGE_IN_MEMORY: '0',
        },
      },
    );
  }
  step(step, options) {
    if (!this.child) this.start();
    return this.child.request('step', step, options);
  }
  async close() {
    if (!this.child) return;
    try {
      if (!this.child.failure)
        await this.child.request('close', {}, { timeout: 10000 });
    } finally {
      await this.child.close();
    }
  }
}
