import {beginPublicHost} from './public-host.js';

/** Compare actual retained text-list identities only while the same generated item remains visible. */
function observeLists(host, previous, counts) {
  const current = new Map();
  for (const [id, entry] of host.sceneRenderer.entries) {
    const node = host.nodes.get(id);
    const text = node?.properties.Text;
    if (!node?.type.endsWith('.TextBlock') || !/^Retained row \d{5}$/.test(text ?? '')) continue;
    const before = previous.get(id);
    if (before?.text === text) {
      counts.comparedDisplayLists++;
      if (before.list !== entry.list) counts.unchangedDisplayListRebuilds++;
      else counts.retainedDisplayLists++;
    }
    current.set(id, {text, list: entry.list});
  }
  counts.maximumVisibleTextLists = Math.max(counts.maximumVisibleTextLists, current.size);
  return current;
}

/** Ten thousand real source items drive managed containers, native scroll offsets and retained rendering on animation frames. */
export async function createRetainedScrollFixture(definition, options) {
  const session = beginPublicHost(definition, options);
  try {
    const {app, host} = session;
    const X = app.Microsoft.UI.Xaml;
    const list = new X.Controls.ListView();
    const window = new X.Window();
    list.Name = 'RetainedList';
    list.Width = definition.width;
    list.Height = definition.height;
    list.ItemHeight = 32;
    list.ItemsSource = Array.from({length: 10000}, (_, index) => 'Retained row ' + String(index).padStart(5, '0'));
    window.Content = list;
    window.Activate();
    await session.settle();
    const node = [...host.nodes.values()].find(value => value.properties.Name === 'RetainedList');
    const viewport = host.states.get(node?.id)?.familyTemplate?.root ?? host.elements.get(node?.id);
    if (!viewport || node.properties.$items?.count !== 10000 || viewport.scrollHeight <= viewport.clientHeight) {
      throw new Error('The 10k fixture did not create a real scrollable virtualized source');
    }
    const counts = {comparedDisplayLists: 0, retainedDisplayLists: 0, unchangedDisplayListRebuilds: 0,
      maximumVisibleTextLists: 0, scrollFrames: 0, changedScrollOffsets: 0, maximumRealizedItems: 0};
    let previous = new Map();
    let lastOffset = viewport.scrollTop;
    return {...session,
      renderFrame({index = 0, warmup = false} = {}) {
        // Small real offsets retain most rows while crossing item boundaries regularly.
        viewport.scrollTop = Math.max(0, index + 1) * 3;
        viewport.dispatchEvent(new options.document.defaultView.Event('scroll'));
        session.renderFrame();
        const observed = viewport.scrollTop;
        if (!warmup) {
          counts.scrollFrames++;
          if (observed !== lastOffset) counts.changedScrollOffsets++;
          previous = observeLists(host, previous, counts);
          counts.maximumRealizedItems = Math.max(counts.maximumRealizedItems,
            node.properties.$items?.realized.length ?? 0);
        } else previous = observeLists(host, new Map(), {...counts});
        lastOffset = observed;
      },
      measurements: () => ({...counts, sourceItemCount: 10000, finalScrollOffset: viewport.scrollTop,
        retentionMeasurement: 'Actual RetainedSceneRenderer entry.list object identities for unchanged generated text items'}),
      verify() {
        if (counts.changedScrollOffsets < 1 || counts.comparedDisplayLists < counts.scrollFrames
          || counts.maximumVisibleTextLists < 2 || counts.maximumRealizedItems >= 10000) {
          throw new Error('Real scroll frames, bounded realization and repeated retained-list comparisons are required');
        }
        if (counts.unchangedDisplayListRebuilds !== 0) throw new Error('Scrolling rebuilt unchanged item display lists');
        return {passed: true, ...counts, sourceItemCount: node.properties.$items.count,
          finalScrollOffset: viewport.scrollTop, geometrySource: 'Native scrollTop and real managed item-container projection'};
      }};
  } catch (error) {
    session.dispose();
    throw error;
  }
}
