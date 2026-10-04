/** Scoped native-input policies remain in the same coordinate system as managed touch constraints. */
export class EnvironmentAppearance {
  constructor(host) {
    this.root = host.root;
    this.previousFont = host.root.style.fontSize;
    this.baseFont = parseFloat(host.document.defaultView.getComputedStyle(host.root).fontSize) || 14;
    const selector = '[data-sf-root="' + host.document.defaultView.CSS.escape(host.rootKey) + '"]';
    const touch = selector + '[data-sf-touch]';
    const contrast = selector + '[data-sf-high-contrast]';
    this.style = host.document.createElement('style');
    this.style.textContent = `${touch} :is(button,input,select,textarea,[role=button],[role=checkbox],[role=radio],
      [role=switch],[role=combobox],[role=slider]) { min-width:40px; min-height:40px; box-sizing:border-box; }
      ${contrast} [data-sf-id] { forced-color-adjust:auto; }
      ${contrast} :is(button,[role=button]) { background-color:ButtonFace !important; color:ButtonText !important;
        border-color:ButtonBorder !important; }
      ${contrast} :is(input,textarea,select) { background-color:Field !important; color:FieldText !important; }
      ${contrast} [aria-disabled=true] { color:GrayText !important; }
      ${contrast} :focus-visible { outline:2px solid Highlight !important; outline-offset:2px; }`;
    host.document.head.append(this.style);
  }
  update(state) { this.root.style.fontSize = this.baseFont * state.TextScaleFactor + 'px'; }
  dispose() { this.style.remove(); this.root.style.fontSize = this.previousFont; }
}
