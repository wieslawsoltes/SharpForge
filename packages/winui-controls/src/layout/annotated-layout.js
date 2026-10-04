import { size, rect } from './geometry.js';
import { arrangeAnnotatedLabels } from './annotated-scrollbar.js';
import { presentedAnnotatedLabels, annotatedTemplateContent } from './annotated-content.js';

export const annotatedScrollLayout = {
  measure(context, available) {
    const labels = presentedAnnotatedLabels(context.node, context.resolve);
    const measured = labels.map((label, index) => label.Content?.$ref
      ? context.measure(label.Content.$ref, size(Math.max(0, available.width - 28), available.height))
      : context.intrinsicOf({ ...context.node, id: context.id + ':label:' + index, type: 'Microsoft.UI.Xaml.Controls.TextBlock',
        properties: { ...context.properties, Text: label.Content == null ? '' : String(label.Content) } }, available));
    context.data.annotatedMeasured = measured;
    context.data.annotatedLabels = labels;
    const detail = annotatedTemplateContent(context.node).detail ?? context.data.annotatedDetailId;
    if (detail) {
      context.suppress(detail, !context.data.annotatedDetailActive);
      context.data.annotatedDetailSize = context.measure(detail, size(360, Infinity));
    }
    return size(Math.max(40, ...measured.map(value => value.width + 28)), Math.min(available.height, 80));
  },
  arrange(context, finalSize) {
    const labels = context.data.annotatedLabels ?? [];
    const buttonHeight = Math.min(24, finalSize.height / 2);
    const railHeight = Math.max(0, finalSize.height - buttonHeight * 2);
    const visible = arrangeAnnotatedLabels(labels, { minimum: context.properties.Minimum ?? 0, maximum: context.properties.Maximum ?? 0,
      height: railHeight, heights: context.data.annotatedMeasured?.map(value => value.height) });
    const positions = new Map(visible.map(value => [value.index, value]));
    for (const [index, label] of labels.entries()) {
      if (!label.Content?.$ref) continue;
      const item = positions.get(index);
      context.arrange(label.Content.$ref, item ? rect(28, buttonHeight + item.y, Math.max(0, finalSize.width - 28), item.height) : rect());
      context.state(label.Content.$ref).data.clip = item ? null : rect();
    }
    const detail = annotatedTemplateContent(context.node).detail ?? context.data.annotatedDetailId;
    if (detail) {
      const desired = context.data.annotatedDetailSize ?? size();
      context.arrange(detail, rect(Math.min(finalSize.width, 48), 24, Math.min(360, desired.width), desired.height));
    }
    context.data.annotatedLayout = { buttonHeight, railHeight, visible };
  }
};
