import {frameworkType, frameworkAssignable, canonicalType, contracts, XAML, CONTROLS} from '@sharpforge/framework';
import {createJavaScriptStyleSystem} from '@sharpforge/winui-properties';

/** Inject framework metadata into the session-owned, shared property/style engine. */
export function createStyleSystem(options) {
  return createJavaScriptStyleSystem({...options, framework: {
    frameworkType, frameworkAssignable, canonicalType, contracts, XAML, CONTROLS
  }});
}
