import {DrawOp} from '@sharpforge/rendering';
import {beginPublicHost} from './public-host.js';

/** Draw enters through the public event, seals its actual managed drawing session, and is rendered by each requested backend. */
export async function createCanvasControlFixture(definition, options) {
  const session = beginPublicHost(definition, options);
  try {
    const {app, host} = session;
    const X = app.Microsoft.UI.Xaml;
    const Colors = app.Microsoft.UI.Colors;
    const canvas = new app.Microsoft.Graphics.Canvas.UI.Xaml.CanvasControl();
    const window = new X.Window();
    let drawCalls = 0;
    let retainedSession;
    canvas.Name = 'PublicCanvasDraw';
    canvas.Width = definition.width;
    canvas.Height = definition.height;
    canvas.Draw.add((sender, args) => {
      if (sender !== canvas) throw new Error('Canvas Draw sender identity changed');
      drawCalls++;
      const drawing = args.DrawingSession;
      retainedSession = drawing;
      drawing.Clear(Colors.Transparent);
      drawing.DrawLine(8, 12, 136, 12, Colors.Red, 0.5);
      drawing.FillRectangle(8, 28, 48, 40, Colors.Blue);
      drawing.DrawRectangle(68, 28, 48, 40, Colors.Red, 2);
      drawing.FillEllipse(40, 100, 24, 16, Colors.Green);
      drawing.DrawEllipse(100, 100, 24, 16, Colors.Blue, 3);
      drawing.DrawText('Canvas Draw AV office', 8, 132, Colors.Black);
    });
    window.Content = canvas;
    window.Activate();
    await session.settle();
    const node = [...host.nodes.values()].find(value => value.properties.Name === canvas.Name);
    const initialVersion = node?.drawingList?.version;
    if (!Number.isInteger(initialVersion) || drawCalls < 1) throw new Error('Canvas initial Draw event did not seal a display list');
    canvas.Invalidate();
    await session.settle();
    return {...session,
      verify() {
        const list = node.drawingList;
        const expected = [DrawOp.Clear, DrawOp.Line, DrawOp.Rectangle, DrawOp.Rectangle,
          DrawOp.Ellipse, DrawOp.Ellipse, DrawOp.GlyphRun];
        if (JSON.stringify(list.commands.map(command => command.op)) !== JSON.stringify(expected)) {
          throw new Error('Canvas Draw did not retain every supported primitive and text command');
        }
        if (drawCalls !== 2 || list.version !== initialVersion + 1 || list.elementId !== node.id) {
          throw new Error('Canvas invalidation must publish one new owner-bound drawing version');
        }
        let sealed = false;
        try { retainedSession.Clear(Colors.Red); }
        catch (error) {
          if (error.code !== 'SFRENDER007') throw error;
          sealed = true;
        }
        if (!sealed) throw new Error('Canvas Draw session remained writable after its event completed');
        return {passed: true, drawEvents: drawCalls, initialVersion, finalVersion: list.version,
          commandNames: ['Clear', 'DrawLine', 'FillRectangle', 'DrawRectangle', 'FillEllipse', 'DrawEllipse', 'DrawText'],
          backend: session.actualBackend(), sealedDrawingSession: true};
      }};
  } catch (error) {
    session.dispose();
    throw error;
  }
}
