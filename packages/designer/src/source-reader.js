import {canonicalType, frameworkType, XAML, CONTROLS} from '@sharpforge/framework';
import {childSlot, normalizeProperty} from './model.js';
import {sourcePath, designIdentifier} from './source-text.js';
import {controlSourceSymbol, isDesignControl} from './source-symbols.js';
import {DesignSyncError, checkSourceCancellation, failSource} from './source-errors.js';
import {readSourceValue, readSourceStyleType} from './source-values.js';
import {readSourceTemplate} from './source-templates.js';
import {readSourceCollection, protectSourceCollectionCall, finishSourceCollections} from './source-collections.js';

/** Construction reader indexes nodes and classifies each direct method statement exactly once. */
export class SourceConstructionReader {
  constructor(context, options) {
    this.context = context;
    this.options = options;
    this.projectTypes = new Map(Array.isArray(options.projectTypes)
      ? options.projectTypes.map(descriptor => [descriptor.type, descriptor.baseType])
      : Object.entries(options.projectTypes ?? {}));
    this.nodes = [];
    this.nodeMap = new Map();
    this.bindings = {};
    this.env = new Map();
    this.styles = {};
    this.templates = {};
    this.resources = new Map();
    this.templateMethods = new Map();
    this.explicitResourceTypes = new Set();
    this.unmanaged = [];
    this.warnings = [];
    this.regions = [];
    this.root = null;
    this.previousNodes = new Map((options.previous?.document?.nodes ?? options.previous?.nodes ?? []).map(node => [node.id, node]));
  }

  lookup(node) {
    const path = sourcePath(node);
    if (this.env.has(path)) return this.env.get(path);
    const owner = this.context.chosen.owner?.name;
    if (path?.startsWith('this.')) return this.env.get(path.slice(5));
    if (owner && path?.startsWith(owner + '.')) return this.env.get(path.slice(owner.length + 1));
    return undefined;
  }

  readValue(node) { return readSourceValue(node, this); }

  controlIdentity(expression) {
    if (expression?.kind !== 'New') return null;
    const symbol = this.context.model.getTypeInfo(expression).type;
    // Both semantic models publish metadataFullName; source spellings and the execution adapter can lose namespaces.
    const resolved = symbol?.metadataFullName ?? symbol?.legacy?.fullName
      ?? (symbol ? this.context.model.symbols.nameOf(symbol) : expression.type);
    const projectType = this.projectTypes.has(resolved) ? resolved : null;
    const type = projectType ? this.projectTypes.get(projectType) : isDesignControl(resolved) ? canonicalType(resolved) : null;
    return type ? {type, projectType} : null;
  }

  controlType(expression) { return this.controlIdentity(expression)?.type ?? null; }

  read() {
    for (const statement of this.context.chosen.method.body.statements) {
      checkSourceCancellation(this.options.signal);
      const region = {id: 'statement:' + this.regions.length, kind: 'designer', uri: statement.uri,
        span: {start: statement.start, end: statement.end}, owners: [], capabilities: ['navigate'], expressions: []};
      this.region = region;
      const understood = this.readStatement(statement);
      if (!understood) this.protect(statement, 'Custom statement is preserved; structural regeneration is disabled');
      if (region.kind === 'designer') region.capabilities.push('remove', 'move');
      this.regions.push(region);
    }
    finishSourceCollections(this);
    return this;
  }

  own(id, expression = null, capability = 'literal') {
    if (!this.region.owners.includes(id)) this.region.owners.push(id);
    if (expression) this.region.expressions.push({span: {start: expression.start, end: expression.end}, capability, owner: id});
  }

  protect(statement, message) {
    this.region.kind = 'handwritten';
    this.unmanaged.push({statement, message});
    return true;
  }

  readStatement(statement) {
    if (statement.kind === 'Local') {
      let understood = true;
      for (const declaration of statement.declarations) {
        understood = this.declare(declaration.name, declaration.initializer, statement, declaration) && understood;
      }
      return understood;
    }
    if (statement.kind === 'Return') {
      const value = this.lookup(statement.expression);
      if (value?.node) this.root = value.node;
      return !!value?.node || !statement.expression;
    }
    if (statement.kind === 'Empty') return true;
    const expression = statement.expression;
    if (expression?.kind === 'Assignment') return this.assignment(expression, statement);
    if (expression?.kind === 'Call') return this.call(expression, statement);
    return false;
  }

  declare(name, expression, statement, declaration = null) {
    if (this.controlType(expression)) {
      return this.control(name, expression, statement, declaration);
    }
    if (expression?.kind === 'New' && canonicalType(expression.type) === XAML + 'Style') return this.style(name, expression, statement);
    if (expression?.kind === 'Call' && this.template(name, expression, statement)) return true;
    try {
      this.env.set(name, this.readValue(expression));
      return true;
    } catch (error) {
      if (!(error instanceof DesignSyncError)) throw error;
      return false;
    }
  }

  control(name, expression, statement, declaration) {
    if (this.nodes.length >= (this.options.maxNodes ?? 5000)) failSource('Design control count limit exceeded', expression, 'SFSYNC_LIMIT');
    const id = designIdentifier(name);
    if (this.bindings[id]) failSource('Ambiguous duplicate control variable ' + name, expression, 'SFSYNC_SYMBOL');
    const identity = this.controlIdentity(expression);
    const type = canonicalType(identity.type);
    const symbol = controlSourceSymbol(this.context, name, expression, declaration);
    const binding = {id, name, uri: expression.uri, statement, creation: expression, properties: {}, events: {}, edges: [],
      tracks: {rows: [], columns: []}, field: !!symbol.field, fieldDeclaration: symbol.field, inline: !declaration && !symbol.field,
      symbolKey: symbol.key, symbolId: symbol.record?.id ?? null, references: symbol.references, declaration: symbol.location,
      declarationOrder: this.nodes.length, sourceType: expression.type};
    const node = {id, type, properties: {}, children: [], events: {}};
    if (identity.projectType) node.projectType = identity.projectType;
    this.nodes.push(node);
    this.nodeMap.set(id, node);
    this.bindings[id] = binding;
    this.env.set(name, {node: id, ref: name});
    this.own(id, expression, 'construction');
    if (expression.args.length) this.protect(statement, 'Control constructors with arguments are not regenerated');
    for (const initializer of expression.initializers ?? []) {
      this.property(binding, initializer.name, initializer.expression, statement, initializer);
    }
    const slot = childSlot(type);
    for (const items of expression.collectionInitializers ?? []) {
      if (slot?.many && items.length === 1) this.edge(binding, slot.property, items[0], statement, {collection: true});
      else this.protect(statement, 'Unsupported collection initializer is protected');
    }
    return true;
  }

  property(binding, key, expression, statement, initializer = null) {
    const node = this.nodeMap.get(binding.id);
    const entry = {expression, statement, initializer};
    this.own(binding.id, expression);
    try {
      if (expression.kind === 'DesignCollection' && childSlot(node.type)?.property === key && childSlot(node.type).many) {
        for (const item of expression.items) {
          if (!this.edge(binding, key, item, statement, {initializer, collection: true})) {
            failSource('Collection child is not a recognized construction or reference', item, 'SFSYNC_DYNAMIC');
          }
        }
        return;
      }
      if (childSlot(node.type)?.property === key && this.edge(binding, key, expression, statement, {initializer})) return;
      const value = this.readValue(expression);
      if (value?.ref) {
        const resource = this.resources.get(value.ref);
        if (!resource || !['Style', 'Template'].includes(key)) failSource('Object reference is not a scalar design value', expression, 'SFSYNC_DYNAMIC');
        node[key === 'Style' ? 'style' : 'template'] = resource.key;
      } else {
        node.properties[key] = normalizeProperty(node.type, key, value);
      }
      if (binding.properties[key]) entry.previous = [...(binding.properties[key].previous ?? []), binding.properties[key]];
      binding.properties[key] = entry;
    } catch (error) {
      if (!(error instanceof DesignSyncError || error instanceof TypeError)) throw error;
      entry.dynamic = true;
      binding.properties[key] = entry;
      const previous = this.previousNodes.get(node.id);
      if (previous?.type === node.type && previous.projectType === node.projectType && Object.hasOwn(previous.properties, key)) {
        node.properties[key] = structuredClone(previous.properties[key]);
      }
      this.region.kind = 'protected';
      this.region.expressions.at(-1).capability = 'navigate';
      this.warnings.push({code: 'SFSYNC_DYNAMIC', node: node.id, property: key, message: error.message,
        uri: expression.uri, start: expression.start, end: expression.end});
    }
  }

  edge(binding, key, expression, statement, extra = {}) {
    let value = this.lookup(expression);
    if (this.controlType(expression)) {
      const name = binding.name + '_' + key + '_' + binding.edges.length;
      this.control(name, expression, statement, null);
      value = this.env.get(name);
    }
    if (!value?.node) return false;
    const parent = this.nodeMap.get(binding.id);
    if (childSlot(parent.type)?.many) parent.children.push(value.node);
    else parent.children = [value.node];
    binding.edges.push({statement, expression, key, child: value.node, ...extra});
    this.own(binding.id, expression, 'edge');
    this.own(value.node);
    return true;
  }

  assignment(expression, statement) {
    const {left, right, operator} = expression;
    const receiver = sourcePath(left.target);
    if (operator === '=' && receiver === 'this' && ['Content', 'Child'].includes(left.name)
      && !this.context.chosen.method.modifiers?.includes('static')) {
      let content = this.lookup(right);
      if (this.controlType(right)) {
        const name = 'this_' + left.name;
        this.control(name, right, statement, null);
        content = this.lookup({kind: 'Name', name});
      }
      if (content?.node) {
        this.root = content.node;
        this.rootAssignment = {receiver: 'this', property: left.name, childId: content.node,
          uri: statement.uri, span: {start: statement.start, end: statement.end}, capabilities: ['preview', 'navigate']};
        this.own(content.node, right, 'root-content');
        return true;
      }
    }
    if (operator === '=' && (left.kind === 'Name' || ['this', this.context.chosen.owner?.name].includes(receiver))) {
      return this.declare(left.name, right, statement, this.context.fields.get(left.name) ?? left);
    }
    const target = left.kind === 'Member' ? this.lookup(left.target) : null;
    if (target?.node) {
      const binding = this.bindings[target.node];
      if (operator === '=') {
        this.property(binding, left.name, right, statement);
        return true;
      }
      if (operator === '+=') return this.event(binding, left.name, right, statement);
    }
    const resource = this.resources.get(receiver);
    if (resource?.kind === 'style' && operator === '=' && left.name === 'BasedOn') {
      this.styles[resource.key].basedOn = this.resources.get(this.lookup(right)?.ref)?.key;
      resource.statements.push(statement);
      return true;
    }
    return false;
  }

  event(binding, event, expression, statement) {
    const node = this.nodeMap.get(binding.id);
    const handler = sourcePath(expression);
    const methodSymbol = this.context.model.getSymbolInfo(expression).symbol;
    const subscription = {expression, statement, handler, symbolKey: methodSymbol?.name ?? null,
      location: methodSymbol?.locations?.[0] ?? null, protected: !handler};
    const previous = binding.events[event];
    const subscriptions = [...(previous?.subscriptions ?? []), subscription];
    const dynamic = !handler || subscriptions.length > 1;
    binding.events[event] = {...subscription, subscriptions, dynamic,
      capability: dynamic ? 'navigate' : 'edit', reason: subscriptions.length > 1 ? 'multiple' : !handler ? 'lambda' : null};
    if (handler && !node.events[event]) node.events[event] = handler;
    this.own(binding.id, expression, dynamic ? 'navigate' : 'handler');
    if (dynamic) {
      this.region.kind = 'protected';
      this.warnings.push({code: 'SFSYNC_EVENT', node: binding.id, event,
        message: subscriptions.length > 1 ? 'Multiple handlers are read-only; navigate to their C# subscriptions.' : 'Lambda handler is protected.',
        uri: expression.uri, start: expression.start, end: expression.end});
    }
    return true;
  }

  call(expression, statement) {
    const target = expression.target;
    const receiver = target.kind === 'Member' ? this.lookup(target.target) : null;
    if (target.name === 'Activate' && receiver?.node) {
      this.root = receiver.node;
      this.own(receiver.node);
      return true;
    }
    if (target.name === 'Add' && target.target?.kind === 'Member') {
      return this.add(expression, statement) || protectSourceCollectionCall(this, expression, statement);
    }
    if (protectSourceCollectionCall(this, expression, statement)) return true;
    const attached = /^(Canvas|Grid|VariableSizedWrapGrid)$/.test(sourcePath(target.target)?.split('.').at(-1) ?? '');
    if (attached && /^Set(?:Left|Top|ZIndex|Row|Column|RowSpan|ColumnSpan)$/.test(target.name) && expression.args.length === 2) {
      const value = this.lookup(expression.args[0]);
      if (!value?.node) return false;
      const key = (sourcePath(target.target).endsWith('VariableSizedWrapGrid') ? 'Wrap' : '') + target.name.slice(3);
      this.property(this.bindings[value.node], key, expression.args[1], statement);
      return true;
    }
    return false;
  }

  add(expression, statement) {
    const target = expression.target.target;
    const parent = this.lookup(target.target);
    const key = target.name;
    if (parent?.node && expression.args.length === 1) {
      const node = this.nodeMap.get(parent.node);
      const binding = this.bindings[node.id];
      if (readSourceCollection(this, binding, key, expression.args[0], statement)) return true;
      if (key === childSlot(node.type)?.property) return this.edge(binding, key, expression.args[0], statement);
      if (['RowDefinitions', 'ColumnDefinitions'].includes(key)) {
        const value = this.readValue(expression.args[0]);
        const axis = key === 'RowDefinitions' ? 'rows' : 'columns';
        (node[axis] ??= []).push(value[axis === 'rows' ? 'Height' : 'Width'] ?? {valueType: XAML + 'GridLength', Value: 1, GridUnitType: 2});
        binding.tracks[axis].push({statement, expression: expression.args[0]});
        this.own(node.id);
        return true;
      }
    }
    const resource = this.resources.get(sourcePath(target.target));
    if (resource?.kind !== 'style' || key !== 'Setters') return false;
    const setter = this.readValue(expression.args[0]);
    if (!setter.setter) return false;
    this.styles[resource.key].setters[setter.setter] = setter.value;
    if (!this.explicitResourceTypes.has(resource.key)) this.styles[resource.key].targetType = setter.targetType;
    resource.statements.push(statement);
    return true;
  }

  style(name, expression, statement) {
    const key = name.replace(/^style_/, '');
    let targetType = CONTROLS + 'Button';
    if (expression.args.length) {
      if (expression.args.length !== 1) failSource('Unsupported Style constructor', expression, 'SFSYNC_OWNERSHIP');
      targetType = readSourceStyleType(expression.args[0], this);
      if (!frameworkType(targetType)) failSource('Style target type must be a supported constant', expression, 'SFSYNC_OWNERSHIP');
      this.explicitResourceTypes.add(key);
    }
    this.styles[key] = {targetType, setters: {}};
    this.resources.set(name, {kind: 'style', key, statements: [statement], declaration: expression});
    this.env.set(name, {ref: name});
    for (const initializer of expression.initializers ?? []) {
      if (initializer.name !== 'BasedOn') return this.protect(statement, 'Unsupported Style initializer ' + initializer.name);
      this.styles[key].basedOn = this.resources.get(this.readValue(initializer.expression).ref)?.key;
    }
    return true;
  }

  template(name, expression, statement) {
    const methodName = sourcePath(expression.target)?.split('.').at(-1);
    const candidates = this.context.methods.filter(candidate => candidate.method.name === methodName);
    if (candidates.length !== 1 || expression.args.length) return false;
    try {
      const method = candidates[0].method;
      const key = name.replace(/^template_/, '');
      this.templates[key] = readSourceTemplate(method, node => this.readValue(node));
      this.resources.set(name, {kind: 'template', key, statements: [statement], declaration: expression});
      this.env.set(name, {ref: name});
      this.templateMethods.set(key, method);
      return true;
    } catch (error) {
      if (!(error instanceof DesignSyncError)) throw error;
      return false;
    }
  }
}
