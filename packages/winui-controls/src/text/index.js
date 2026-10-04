import { registerEditRenderers } from './edit-renderer.js';
import { registerInlineRenderers } from './inlines.js';

export { TextBuffer } from './text-buffer.js';
export { PasswordBuffer, redactPasswordProperties } from './passwordbox.js';
export { RichTextDocument } from './rich-document.js';
export { getTextModel } from './edit-renderer.js';
export { getRichTextDocument, applyTypography, renderRichDocument } from './inlines.js';
export * from './typography.js';
export * from './rich-overflow.js';

export function registerTextRenderers(registry) {
  registerEditRenderers(registry);
  registerInlineRenderers(registry);
}
