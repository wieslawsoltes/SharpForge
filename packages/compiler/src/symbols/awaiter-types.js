/**
 * The types of the awaitable pattern (C# 5, SF-A02-T58) for compilations bound against the closed framework registry:
 * `INotifyCompletion` and `ICriticalNotifyCompletion`, which every awaiter implements, and `TaskAwaiter` /
 * `TaskAwaiter<T>` with `Task.GetAwaiter()`, which user awaitables commonly forward to. The registry lists none of
 * them; the core library of a compilation gets them here, once per bridge.
 */
import { NamedTypeSymbol, TypeKind, Accessibility } from './types.js';
import { MethodSymbol, PropertySymbol, ParameterSymbol, MethodKind, DeclarationModifiers } from './members.js';

const COMPILER_SERVICES = 'System.Runtime.CompilerServices';
const publicMember = { declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true };

function addMethod(owner, name, returnType, parameters = [], modifiers = 0) {
  if (owner.getMembers(name).some(member => member.kind === 'Method' && member.parameters.length === parameters.length)) return;
  const symbols = parameters.map(([parameterName, type]) => new ParameterSymbol({ name: parameterName, type }));
  owner.addMember(new MethodSymbol({ ...publicMember, name, returnType, parameters: symbols, modifiers }));
}

function addReadOnlyProperty(owner, name, type) {
  if (owner.getMembers(name).length) return;
  const getMethod = new MethodSymbol({ ...publicMember, name: 'get_' + name, methodKind: MethodKind.PropertyGet, returnType: type });
  owner.addMember(getMethod);
  owner.addMember(new PropertySymbol({ ...publicMember, name, type, getMethod }));
}

/** The interface `name` in System.Runtime.CompilerServices, declared when the registry's core library does not have it. */
function completionInterface(registry, name, bases) {
  const namespace = registry.globalNamespace.ensureNamespace(COMPILER_SERVICES),
    existing = namespace.getTypeMembers(name, 0)[0];
  if (existing) return existing;
  const type = new NamedTypeSymbol({ name, typeKind: TypeKind.Interface, declaredAccessibility: Accessibility.Public, interfaces: bases });
  namespace.addType(type);
  return type;
}

/**
 * Resolves the awaiter types on `core` (`inotifyCompletion`, `icriticalNotifyCompletion`, `taskAwaiter`,
 * `taskAwaiterT`) and gives them the members of the awaitable pattern.
 * @param core the CoreTypes being built (`bridge`, `bool`, `void`, `task`, `taskT`)
 */
export function declareAwaiterTypes(core) {
  const library = core.bridge;
  if (library.assembly) {
    // A referenced core library declares the types itself.
    const imported = name => library.assembly.getTypeByMetadataName(COMPILER_SERVICES + '.' + name) ?? null;
    core.inotifyCompletion = imported('INotifyCompletion');
    core.icriticalNotifyCompletion = imported('ICriticalNotifyCompletion');
    core.taskAwaiter = imported('TaskAwaiter');
    core.taskAwaiterT = imported('TaskAwaiter`1');
    return;
  }
  const bridge = library.bridge ?? library,
    continuation = [['continuation', core.action(0)]],
    notify = completionInterface(bridge, 'INotifyCompletion', []),
    critical = completionInterface(bridge, 'ICriticalNotifyCompletion', [notify]),
    awaiter = bridge.coreType('System_Runtime_CompilerServices_TaskAwaiter'),
    awaiterT = bridge.coreType('System_Runtime_CompilerServices_TaskAwaiter_T');
  Object.assign(core, { inotifyCompletion: notify, icriticalNotifyCompletion: critical, taskAwaiter: awaiter, taskAwaiterT: awaiterT });
  if (bridge.awaiterTypesDeclared) return;
  bridge.awaiterTypesDeclared = true;
  addMethod(notify, 'OnCompleted', core.void, continuation, DeclarationModifiers.Abstract);
  addMethod(critical, 'UnsafeOnCompleted', core.void, continuation, DeclarationModifiers.Abstract);
  for (const type of [awaiter, awaiterT]) {
    if (type.isErrorType()) continue;
    if (!type.interfaces.length) type._interfaces = [critical, notify];
    addReadOnlyProperty(type, 'IsCompleted', core.bool);
    addMethod(type, 'OnCompleted', core.void, continuation);
    addMethod(type, 'UnsafeOnCompleted', core.void, continuation);
    addMethod(type, 'GetResult', type === awaiterT ? type.typeParameters[0] : core.void);
  }
  if (!awaiter.isErrorType()) addMethod(core.task, 'GetAwaiter', awaiter);
  if (awaiterT.isErrorType()) return;
  addMethod(core.taskT, 'GetAwaiter', awaiterT.construct(core.taskT.typeParameters[0]));
  // A registry instantiation (`Task<int>`) lists its own contracts only and derives from `Task`: without a member of
  // its own it would inherit the non-generic `Task.GetAwaiter()`.
  for (const instance of core.taskT.instances ?? []) {
    const getAwaiter = new MethodSymbol({ ...publicMember, name: 'GetAwaiter', returnType: awaiterT.construct(instance.typeArguments[0].type), parameters: [] });
    getAwaiter.containingSymbol = instance;
    instance.getMembers().push(getAwaiter);
  }
}
