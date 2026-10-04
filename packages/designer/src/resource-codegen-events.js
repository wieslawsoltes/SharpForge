import {eventsFor, frameworkType} from '@sharpforge/framework';
import {authoringError} from './property-diagnostics.js';
import {quoteDesignerString} from './resource-codegen-values.js';

/** Project stubs follow the registered delegate, including native typed Window.SizeChanged arguments. */
export function generateDesignerProjectHandlers(design) {
  const handlers = new Map();
  for (const node of design.nodes) {
    for (const [event, target] of Object.entries(node.events)) {
      if (!target.startsWith('Program.')) continue;
      const name = target.slice(8);
      const delegate = frameworkType(eventsFor(node.type)[event]);
      if (!delegate || delegate.result !== 'void') authoringError('SFD1876', 'Project event stubs require a registered void delegate.');
      const parameters = delegate.parameters.map((type, index) => `${type} ${index === 0 ? 'sender' : index === 1 ? 'args' : 'arg' + index}`);
      const key = name + '(' + delegate.parameters.join(',') + ')';
      handlers.set(key, `    public static void ${name}(${parameters.join(', ')})\n` +
        `    {\n        Console.WriteLine(${quoteDesignerString(name + ' invoked')});\n    }`);
    }
  }
  return [...handlers.values()].join('\n');
}
