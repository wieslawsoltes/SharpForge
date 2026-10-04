import {probeDesignSource} from '@sharpforge/designer';

/** A bounded candidate check only; the compiler worker must prove the generated resource-class syntax before opening its preview. */
export function classifyDesignerSource(text, uri) {
  const result = probeDesignSource(text, uri);
  if (result.compatible || typeof text !== 'string' || text.length > 2_000_000 || !/\.cs$/i.test(uri)) return result;
  if (!text.includes('ResourceDictionary') || !text.includes('XamlReader') || !text.includes('Create')) return result;
  return {uri, compatible: true, kind: 'resources', candidate: true, reason: null};
}
