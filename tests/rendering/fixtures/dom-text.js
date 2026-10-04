import {DrawingContext, BrowserTextProvider, TextLayoutService} from '@sharpforge/rendering';
import {textOptions, measureDomText, textReference} from '../references/dom-text.js';

function compareTextLayout(actual, expected) {
  if (actual.lines.length !== expected.lines.length || actual.trimmed !== expected.trimmed) {
    throw new Error('Text line count or trimming differs from the independent DOM reference');
  }
  for (const [index, line] of actual.lines.entries()) {
    const reference = expected.lines[index];
    const fields = ['start', 'end', 'visibleEnd', 'text'];
    for (const name of fields) {
      if (line[name] !== reference[name]) throw new Error(`DOM line ${index} ${name} mismatch: ${line[name]} versus ${reference[name]}`);
    }
    if (Math.abs(line.width - reference.width) > 0.1) throw new Error('DOM line/ellipsis width differs by more than 0.1 DIP');
  }
}

/** Actual browser text layout is compared to a separately mounted native DOM paragraph before raster comparison. */
export async function createDomTextFixture(definition, {document, resources}) {
  const text = definition.text ?? 'AV fi\nمرحبا\nA\u0301 👩‍💻';
  const options = textOptions(definition);
  const provider = new BrowserTextProvider(document);
  const service = new TextLayoutService(provider);
  try {
    const run = await service.shape(text, options);
    const reference = measureDomText(document, text, options);
    const drawing = new DrawingContext({elementId: definition.id, version: 1});
    drawing.DrawGlyphRun(resources.register('glyphRun', run), [4, 2], definition.foreground ?? '#202020');
    return {list: drawing.finish([0, 0, definition.width, definition.height]), width: definition.width,
      height: definition.height, textService: service,
      verify() {
        compareTextLayout(run, reference);
        return {passed: true, reference: reference.reference, lineCount: reference.lines.length,
          lineBreaks: reference.lines.map(line => [line.start, line.end]),
          trimming: {applied: run.trimmed, visibleEnd: run.lines.at(-1)?.visibleEnd ?? null,
            actualWidth: run.lines.at(-1)?.width ?? 0, referenceWidth: reference.lines.at(-1)?.width ?? 0}};
      },
      reference: () => textReference(document, definition, text, options, reference),
      dispose: () => service.dispose()};
  } catch (error) {
    service.dispose();
    throw error;
  }
}
