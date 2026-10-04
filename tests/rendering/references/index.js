import {paintPrimitiveReference} from './canvas-primitives.js';
import {effectReference} from './svg-effects.js';
import {compositionReference} from './composition.js';

/** All returned pixels come from native browser APIs driven by declared input, never backend golden files. */
export function declaredReference(document, definition) {
  if (definition.scene === 'effects') return effectReference(document, definition);
  if (definition.scene.startsWith('composition-')) return compositionReference(document, definition);
  const result = paintPrimitiveReference(document, definition);
  if (!result) throw new TypeError('No independent reference declared for fixture: ' + definition.id);
  return result;
}
