export const diagnosticMetrics = Object.freeze({
  liveBytes: {label: 'Live managed heap', unit: 'bytes'},
  liveObjects: {label: 'Live managed objects', unit: 'objects'},
  occupancyPercent: {label: 'Worker execution occupancy', unit: '%', maximum: 100}
});

/** Mean occupancy is weighted by actual interval duration, including irregular browser scheduling. */
export function executionSummary(samples) {
  const durationMs = samples.reduce((sum, sample) => sum + sample.durationMs, 0);
  const busyMs = samples.reduce((sum, sample) => sum + sample.busyMs, 0);
  return {intervals: samples.length, durationMs, busyMs, mean: durationMs ? busyMs / durationMs * 100 : null,
    latest: samples.at(-1)?.occupancyPercent ?? null, peak: samples.length ? Math.max(...samples.map(sample => sample.occupancyPercent)) : null};
}

function drawing(canvas) {
  const context = canvas.getContext('2d');
  if (!context) return null;
  const window = canvas.ownerDocument?.defaultView ?? globalThis;
  const ratio = Math.min(3, Math.max(1, window.devicePixelRatio ?? 1));
  const width = Math.max(180, Math.min(2400, canvas.clientWidth || 600)), height = 150;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const style = window.getComputedStyle?.(canvas);
  context.strokeStyle = style?.getPropertyValue('--wb-accent') || 'CanvasText';
  context.fillStyle = style?.getPropertyValue('--wb-text') || 'CanvasText';
  context.lineWidth = 2;
  context.font = '11px sans-serif';
  return {context, width, height};
}

export function drawDiagnosticGraph(canvas, samples, metric) {
  const settings = diagnosticMetrics[metric], values = samples.filter(sample => Number.isFinite(sample[metric]));
  const chart = drawing(canvas);
  if (!chart || !values.length) return false;
  const {context, width, height} = chart;
  const maximum = settings.maximum ?? Math.max(1, ...values.map(sample => sample[metric]));
  const intervals = metric === 'occupancyPercent';
  const start = intervals ? values[0].startMs : values[0].timestamp;
  const end = values.at(-1).timestamp, span = Math.max(1, end - start);
  context.fillText(maximum.toLocaleString() + ' ' + settings.unit, 4, 13);
  context.fillText('0', 4, height - 23);
  context.fillText((start / 1000).toFixed(2) + ' s', 44, height - 4);
  context.textAlign = 'right';
  context.fillText((end / 1000).toFixed(2) + ' s', width - 4, height - 4);
  context.textAlign = 'left';
  context.beginPath();
  values.forEach((sample, index) => {
    const x = 44 + ((intervals ? sample.startMs : sample.timestamp) - start) / span * (width - 52);
    const y = height - 25 - sample[metric] / maximum * (height - 45);
    const gap = intervals && index > 0 && sample.sequence !== values[index - 1].sequence + 1;
    if (!index || gap) context.moveTo(x, y);
    else context.lineTo(x, y);
    if (intervals) context.lineTo(44 + (sample.endMs - start) / span * (width - 52), y);
  });
  context.stroke();
  const latest = values.at(-1)[metric];
  canvas.setAttribute('aria-label', `${settings.label}: ${values.length} samples; latest ${latest.toFixed(2)} ${settings.unit}; ` +
    `${(start / 1000).toFixed(2)} to ${(end / 1000).toFixed(2)} seconds`);
  return true;
}

export function drawEventTimeline(canvas, events) {
  const chart = drawing(canvas);
  if (!chart || !events.length) return false;
  const {context, width, height} = chart;
  const start = events[0].timestamp, end = events.at(-1).timestamp, span = Math.max(1, end - start);
  context.beginPath();
  for (const event of events) {
    const x = 8 + (event.timestamp - start) / span * (width - 16);
    context.moveTo(x, 28);
    context.lineTo(x, height - 30);
  }
  context.stroke();
  context.fillText(events.length + ' delivered events', 8, 15);
  context.fillText((start / 1000).toFixed(2) + '–' + (end / 1000).toFixed(2) + ' seconds since launch observation', 8, height - 8);
  canvas.setAttribute('aria-label', events.length + ' diagnostic events; the event table provides each time and description');
  return true;
}
