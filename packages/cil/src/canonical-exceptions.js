import {managedExceptionTypes} from '@sharpforge/bytecode';
import {CilError} from './binary.js';

const names = [...managedExceptionTypes.map(type => type.name), 'Microsoft.UI.Xaml.Markup.XamlParseException'];
const approved = new Map(names.flatMap(name => [[name, name], [name.slice(name.lastIndexOf('.') + 1), name]]));

/** The emitted profile preserves the exact approved managed catch type, including derived exceptions. */
export function canonicalCatchType(type) {
  const canonical = approved.get(type);
  if (!canonical) throw new CilError('Unsupported canonical managed catch type: ' + String(type));
  return canonical === 'System.Exception' ? 'Exception' : canonical;
}
