import {Accessibility, RefKind, TypeKind} from './types.js';
import {DeclarationModifiers, MethodSymbol, ParameterSymbol} from './members.js';

/** Older released ABI entries lack visibility flags; this table supplies only documented UI override slots. */
const protectedVirtual = new Map([
  ['Microsoft.UI.Xaml.UIElement', new Set(['OnCreateAutomationPeer'])],
  ['Microsoft.UI.Xaml.Automation.Peers.AutomationPeer', new Set([
    'GetNameCore', 'GetClassNameCore', 'GetAutomationIdCore', 'GetHelpTextCore', 'GetItemStatusCore', 'IsEnabledCore',
    'IsKeyboardFocusableCore', 'HasKeyboardFocusCore', 'IsOffscreenCore', 'IsPasswordCore', 'IsControlElementCore',
    'IsContentElementCore', 'GetBoundingRectangleCore', 'GetChildrenCore', 'GetPatternCore', 'SetFocusCore',
    'GetAutomationControlTypeCore'
  ])],
  ['Microsoft.UI.Xaml.FrameworkElement', new Set(['MeasureOverride', 'ArrangeOverride'])],
  ['Microsoft.UI.Xaml.Controls.Control', new Set(['OnApplyTemplate'])],
  ['Microsoft.UI.Xaml.Controls.Page', new Set(['OnNavigatedTo', 'OnNavigatedFrom', 'OnNavigatingFrom'])],
  ['Microsoft.UI.Xaml.Application', new Set(['OnLaunched', 'OnActivated'])],
  ['Microsoft.UI.Xaml.Controls.DataTemplateSelector', new Set(['SelectTemplateCore'])],
  ['Microsoft.UI.Xaml.Controls.StyleSelector', new Set(['SelectStyleCore'])],
  ['Microsoft.UI.Xaml.Controls.ItemsControl', new Set([
    'GetContainerForItemOverride', 'IsItemItsOwnContainerOverride', 'PrepareContainerForItemOverride', 'ClearContainerForItemOverride'
  ])]
]);

export function registryParameter(bridge, typeName, index, mode) {
  const byref = typeName.endsWith('&');
  const type = bridge.typeFromName(byref ? typeName.slice(0, -1) : typeName) ?? bridge.objectType;
  const refKind = !byref ? RefKind.None : mode === 'out' ? RefKind.Out : mode === 'in' ? RefKind.In : RefKind.Ref;
  return new ParameterSymbol({name: 'arg' + index, type, ordinal: index, refKind});
}

export function registryMethodSymbol(bridge, contract, owner, methodKind) {
  const profileVirtual = protectedVirtual.get(contract.owner)?.has(contract.name) === true;
  const abstract = contract.isAbstract || owner.typeKind === TypeKind.Interface;
  const virtual = contract.isVirtual || profileVirtual;
  const access = contract.accessibility ?? contract.access;
  const declaredAccessibility = access === 'protected' || !access && profileVirtual
    ? Accessibility.Protected : Accessibility.Public;
  const modifiers = (contract.isStatic ? DeclarationModifiers.Static : 0) |
    (abstract ? DeclarationModifiers.Abstract : 0) | (virtual ? DeclarationModifiers.Virtual : 0);
  const method = new MethodSymbol({containingSymbol: owner, declaredAccessibility, modifiers,
    name: contract.name, methodKind,
    returnType: contract.kind === 'constructor' ? bridge.byName.get('void') : bridge.typeFromName(contract.result) ?? bridge.objectType,
    parameters: contract.parameters.map((p, index) => registryParameter(bridge, p, index, contract.parameterModes?.[index]))});
  method.contract = contract;
  bridge.contractSymbols.set(contract.id, method);
  return method;
}
