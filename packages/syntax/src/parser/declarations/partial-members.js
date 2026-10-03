import { accessibilityModifiers } from '../modifiers.js';
/**
 * `partial` members by language version: partial methods (C# 3), extended partial methods with accessibility or a
 * non-void return type (C# 9), partial properties and indexers (C# 13), partial constructors and events (C# 14).
 * Defining and implementing declarations have the same syntax; pairing them is the binder's job.
 */
const extendedModifiers = new Set([...accessibilityModifiers, 'virtual', 'override', 'sealed', 'new', 'extern']);
export const partialMemberMethods = {
  /** Records the feature a `partial` member of node kind `kind` needs. `token` anchors the diagnostic (the member name or keyword). */
  partialMember(modifiers, kind, token, returnType = null) {
    if (!modifiers.some(modifier => modifier.kind === 'PartialKeyword')) return;
    if (kind === 'MethodDeclaration') {
      this.feature('PartialMethod', token);
      const isVoid = returnType?.kind === 'PredefinedType' && returnType.children[0].kind === 'VoidKeyword';
      if (!isVoid || modifiers.some(modifier => extendedModifiers.has(modifier.text))) this.feature('ExtendedPartialMethods', token);
    } else if (kind === 'PropertyDeclaration' || kind === 'IndexerDeclaration') this.feature('PartialProperties', token, token, 'partial');
    else this.feature('PartialEventsAndConstructors', token);
  }
};
