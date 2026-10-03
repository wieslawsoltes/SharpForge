/**
 * Lowering of primary constructors (SF-A02-T10.5).
 *
 *   class C(int a, int b) { int f = a; public int B => b; }
 *     field  <b>P                                  one field per parameter an instance member captures
 *     .ctor(a, b):  this.<b>P = b;                 captures are stored first, as Roslyn emits them,
 *                   this.<init>(a, b);             then the initializers run with the parameters in scope
 *     get_B:        return this.<b>P;
 *
 * Two mixins: one for the generator (the capture fields and the constructor body), one for the body translator
 * (a captured parameter read or written in a member is its field).
 */
import { SymbolKind } from '../../symbols/types.js';
import { primaryConstructorParameterFieldName } from '../generated-names.js';
import { n } from '../../codegen/semantic/node-factory.js';

/** Generator mixin: capture fields and the body of a primary constructor. */
export const PrimaryConstructorGeneration = Base =>
  class extends Base {
    /** Parameter symbol -> the image field that holds it once the constructor has run. */
    get primaryCaptures() {
      return (this.primaryCaptureFields ??= new Map());
    }
    declareMembers(type) {
      super.declareMembers(type);
      const owner = this.classes.get(type);
      for (const parameter of type.primaryConstructor?.parameters ?? []) {
        if (!parameter.capturedByType) continue;
        const imageType = this.types.imageType(parameter.type, parameter.locations?.[0]);
        this.primaryCaptures.set(parameter, this.program.addField(owner, primaryConstructorParameterFieldName(parameter.name), imageType));
      }
    }
    /** A primary constructor has no body of its own: it stores the captures and runs the instance initializers. */
    synthesizeAccessor(symbol, record) {
      if (symbol.kind !== SymbolKind.Method || !symbol.isPrimaryConstructor) return super.synthesizeAccessor(symbol, record);
      const type = symbol.containingType ?? symbol.containingSymbol,
        at = symbol.locations?.[0];
      if (symbol.baseArgumentsSyntax) return this.unsupported('base constructor calls', at, this.uriOf(symbol));
      const self = () => n.thisReference(record.owner.name),
        argument = index => n.parameter(n.newParameter(record.parameters[index].name, record.parameters[index].type, index)),
        statements = [];
      const ensure = this.typeInitializerCall(symbol, { anyMember: true });
      if (ensure) statements.push(n.expressionStatement(ensure));
      symbol.parameters.forEach((parameter, index) => {
        const field = this.primaryCaptures.get(parameter);
        if (field) statements.push(n.expressionStatement(n.assign(n.field(self(), field), argument(index))));
      });
      const init = this.instanceInits.get(type);
      if (init) statements.push(n.expressionStatement(n.call(init, self(), symbol.parameters.map((parameter, index) => argument(index)))));
      this.addSynthesizedBody(record, n.block(statements));
      return undefined;
    }
  };

/** Translator mixin: a captured primary constructor parameter is a field of `this` outside the constructor. */
export const PrimaryConstructorLowering = Base =>
  class extends Base {
    variable(symbol, syntax) {
      const field = this.frame.vars.has(symbol) ? null : this.g.primaryCaptures.get(symbol);
      if (!field) return super.variable(symbol, syntax);
      return this.frame.thisExpr ? n.field(this.frame.thisExpr(), field) : this.unsupported(`parameter '${symbol.name}' in this position`, syntax);
    }
  };
