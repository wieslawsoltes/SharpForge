import {ManagedFault} from './managed-fault.js';
import {createHeapReference} from './heap-reference.js';

const fail = message => { throw new ManagedFault('InvalidOperationException', message); };

/** Resolve scene names to heap-issued references before storing animation roots. */
export function animationTarget(platform, reference) {
  let object = platform.get(reference, '$Target');
  if (!object) {
    const name = platform.native(platform.get(reference, '$TargetName'));
    const matches = platform.scene().nodes.filter(node => node.properties.Name === name);
    if (matches.length !== 1) fail('Storyboard target name is missing or ambiguous: ' + name);
    const [handle, generation] = matches[0].id.split(':').map(Number);
    object = createHeapReference(platform.heap, handle, generation);
    platform.heap.get(object);
  }
  let property = platform.native(platform.get(reference, '$TargetProperty'));
  if (typeof property !== 'string' || property.length > 250) fail('A target property is required');
  property = property.replace(/[()]/g, '');
  if (property.includes('RenderTransform.')) {
    object = platform.get(object, 'RenderTransform');
    property = property.split('.').at(-1);
    if (!object) fail('RenderTransform is null');
  } else if (/^(?:(?:Microsoft\.UI\.Xaml\.Controls\.)?Canvas\.)?(Left|Top)$/.test(property) && property.includes('.')) {
    property = '$' + property.split('.').at(-1);
  } else if (property.includes('.')) fail('Unsupported storyboard property path: ' + property);
  return {object, property};
}
