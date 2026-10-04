/** Lower metadata-bound project members into explicit external IR operations after normal accessibility checks. */
const expression = (kind, legacyType, fields) => ({ kind, legacyType, isExpression: true, ...fields });

export const ProjectReferenceTranslation = Base => class extends Base {
  projectCall(method, receiver, args, syntax) {
    const reference = this.g.projectReferences.method(method, syntax);
    return expression('ProjectCall', reference.descriptor.returnType, { reference, receiver, args });
  }

  exprCall(node) {
    if (node.isOmitted || !this.g.projectReferences.handles(node.method)) return super.exprCall(node);
    return this.projectCall(node.method, node.method.isStatic ? null : this.receiver(node), this.arguments(node, node.method), node.syntax);
  }

  exprObjectCreation(node) {
    if (!this.g.projectReferences.handles(node.type)) return super.exprObjectCreation(node);
    const reference = this.g.projectReferences.method(node.constructor, node.syntax);
    const type = this.g.projectReferences.type(node.type, node.syntax);
    const created = expression('ProjectNewObject', type.imageName, { reference, args: this.arguments(node, node.constructor) });
    return node.initializers?.length || node.collectionInitializers?.length ? this.withInitializers(node, created) : created;
  }

  fieldReference(node) {
    if (!this.g.projectReferences.handles(node.field)) return super.fieldReference(node);
    const reference = this.g.projectReferences.field(node.field, node.syntax);
    return expression('ProjectField', reference.descriptor.fieldType,
      { reference, receiver: node.field.isStatic ? null : this.memberReceiver(node) });
  }

  projectProperty(node) {
    const property = node.property;
    const references = this.g.projectReferences;
    return expression('ProjectProperty', this.imageType(property.type, node.syntax), {
      receiver: property.isStatic ? null : this.memberReceiver(node),
      args: node.args?.length ? this.arguments(node, property) : [],
      // Resolve only the accessor actually emitted; an unused private counterpart is not a dependency.
      get: property.getMethod ? () => references.method(property.getMethod, node.syntax) : null,
      set: property.setMethod ? () => references.method(property.setMethod, node.syntax) : null,
    });
  }

  propertyReference(node) {
    return this.g.projectReferences.handles(node.property) ? this.projectProperty(node) : super.propertyReference(node);
  }

  indexerReference(node) {
    return this.g.projectReferences.handles(node.property) ? this.projectProperty(node) : super.indexerReference(node);
  }

  exprUnary(node) {
    return this.g.projectReferences.handles(node.method)
      ? this.projectCall(node.method, null, [this.expression(node.operand)], node.syntax) : super.exprUnary(node);
  }

  exprBinary(node) {
    if (!this.g.projectReferences.handles(node.method)) return super.exprBinary(node);
    if (node.isLogical || node.isLifted) return this.unsupported('lifted or conditional project operators', node.syntax);
    return this.projectCall(node.method, null, [this.expression(node.left), this.expression(node.right)], node.syntax);
  }

  userDefinedConversion(node) {
    const method = node.conversion.method ?? node.method;
    return this.g.projectReferences.handles(method)
      ? this.projectCall(method, null, [this.expression(node.operand)], node.syntax) : super.userDefinedConversion(node);
  }
};
