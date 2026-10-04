import { readDesignXaml } from './xaml-reader.js';
import { planDesignXamlUpdate } from './xaml-writer.js';
import { xamlError } from './xaml-values.js';

/** Explicit, versioned XAML/design baseline with the same host transaction protocol as CSharpDesignSession. */
export class XamlDesignSession {
  constructor(text, options = {}) {
    this.options = options;
    this.analysis = readDesignXaml(text, options);
    this.version = 0;
  }

  read(text) {
    const analysis = readDesignXaml(text, { ...this.options, previous: this.analysis.document });
    this.analysis = analysis;
    this.version++;
    return this.document;
  }

  plan(document, currentText = this.analysis.text) {
    return { ...planDesignXamlUpdate(this.analysis, document, currentText, this.options), expectedVersion: this.version };
  }

  commit(plan) {
    if (plan.expectedVersion !== this.version) throw xamlError('SFXAML007', 'A newer synchronization has replaced this XAML update');
    this.analysis = plan.analysis;
    this.version++;
    return this.document;
  }

  get document() { return structuredClone(this.analysis.document); }
}
