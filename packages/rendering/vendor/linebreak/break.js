export class Break {
  /**
   * If the `string` option is enabled, a slice of the original input.
   *
   * @type {string=}
   */
  string = undefined;

  /**
   * Extra info from plugin rules.
   *
   * @type {Record<string,any>=}
   */
  props = undefined;

  /**
   * @param {number} position
   * @param {boolean} [required=false]
   */
  constructor(position, required = false) {
    /**
     * Offset into input string in JS characters (16bit code units).
     *
     * @type {number}
     */
    this.position = position;

    /**
     * Is this a required break?
     *
     * @type {boolean}
     */
    this.required = required;
  }
}
