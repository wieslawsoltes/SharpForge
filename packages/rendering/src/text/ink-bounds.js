/** Union layout and native glyph ink bounds so italic overhangs and accents are not cropped by raster atlases. */
export function textInkBounds(run, measurement) {
  let left = 0, top = 0, right = run.width, bottom = run.height;
  measurement.save();
  for (const line of run.lines) {
    const groups = line.fontRuns?.length ? line.fontRuns : [{text: line.text, font: run.font,
      direction: line.direction, left: line.left, width: line.width, baseline: line.baseline}];
    for (const group of groups) {
      measurement.font = group.font; measurement.direction = group.direction;
      measurement.textAlign = group.direction === 'rtl' ? 'right' : 'left';
      if ('wordSpacing' in measurement) measurement.wordSpacing = `${group.wordSpacing ?? 0}px`;
      const metrics = measurement.measureText(group.text), origin = group.direction === 'rtl' ? group.left + group.width : group.left;
      left = Math.min(left, origin - (metrics.actualBoundingBoxLeft ?? 0));
      right = Math.max(right, origin + (metrics.actualBoundingBoxRight ?? group.width));
      top = Math.min(top, group.baseline - (metrics.actualBoundingBoxAscent ?? run.ascent));
      bottom = Math.max(bottom, group.baseline + (metrics.actualBoundingBoxDescent ?? run.descent));
    }
  }
  measurement.restore();
  return [left, top, right - left, bottom - top];
}
