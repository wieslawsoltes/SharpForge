/** Where a body runs: its image method, how `this` and the variables of enclosing bodies are reached. */
export class Frame {
  /**
   * @param {object} init `{uri, method, thisExpr, captures, root}`: `method` is the image method record, `thisExpr`
   *   builds the receiver (null in static code), `captures` the CaptureAnalysis of the enclosing source method and
   *   `root` its naming state `{name, ordinal, lambdas, closures, localFunctions: Map}`
   */
  constructor(init) {
    this.uri = init.uri;
    this.method = init.method;
    this.thisExpr = init.thisExpr ?? null;
    this.captures = init.captures;
    this.root = init.root;
    /** variable symbol -> () => expression that reads (and can be assigned to) the variable */
    this.vars = new Map();
    /** captured variable symbol -> () => expression yielding its cell object */
    this.cells = new Map();
  }
}
