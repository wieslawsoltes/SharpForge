import {DrawingContext} from './context.js';
import {DrawingError} from './commands.js';
import {parseColor} from '../media/colors.js';
import {around, rotation} from '../media/transforms.js';

/** Compatibility projection for the three released DrawingSurface methods; no unreachable ellipse opcode. */
export function drawingPrimitives(commands = []) {
  const result = [];
  for (const command of commands) {
    const args = command.args ?? [];
    if (command.op === 'Clear') { result.length = 0; continue; }
    if (command.op === 'FillRectangle') {
      const [x, y, w, h, color] = args; result.push({x, y, w, h, color: parseColor(color), kind: 0, angle: 0});
    } else if (command.op === 'DrawLine') {
      const [x1, y1, x2, y2, width, color] = args, length = Math.hypot(x2 - x1, y2 - y1);
      result.push({x: (x1 + x2) / 2 - length / 2, y: (y1 + y2) / 2 - width / 2, w: length, h: width,
        color: parseColor(color), kind: 0, angle: Math.atan2(y2 - y1, x2 - x1)});
    } else throw new DrawingError('SFRENDER120', `Unknown released DrawingSurface command ${command.op}`);
  }
  return result;
}

export function primitivesToDisplayList(primitives, version = 0) {
  if (!Array.isArray(primitives) || primitives.length > 1000000) throw new DrawingError('SFRENDER008', 'Primitive count exceeds budget');
  const context = new DrawingContext({version, maxCommands: Math.max(1, primitives.length * 3)});
  for (const primitive of primitives) {
    const rect = [primitive.x, primitive.y, primitive.w, primitive.h], angle = primitive.angle ?? 0;
    if (angle) context.PushTransform(around(rotation(angle * 180 / Math.PI), primitive.x + primitive.w / 2, primitive.y + primitive.h / 2));
    const brush = primitive.fill === null ? null : primitive.fill ?? primitive.color;
    const pen = primitive.pen ?? (primitive.stroke ? {width: primitive.strokeWidth ?? 1, brush: primitive.stroke} : null);
    if (primitive.kind === 1) context.DrawEllipse(rect, brush, pen);
    else if (primitive.radii || primitive.radiusX || primitive.radiusY) {
      context.DrawRoundedRectangle(rect, primitive.radii ?? [primitive.radiusX ?? 0, primitive.radiusY ?? 0], brush, pen);
    } else context.DrawRectangle(rect, brush, pen);
    if (angle) context.Pop();
  }
  return context.finish();
}

export function drawingCommandsToDisplayList(commands, version = 0) { return primitivesToDisplayList(drawingPrimitives(commands), version); }
