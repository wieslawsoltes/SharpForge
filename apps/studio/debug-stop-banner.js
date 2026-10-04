import {escapeHtml} from '@sharpforge/editor';
import {workspaceFileForDebugSource} from './debug-sources.js';

function phaseDescription(reason) {
  if (reason.phase === 'after') {
    return reason.reason === 'data breakpoint' ? 'After storage write' : 'After exception was thrown';
  }
  if (reason.phase === 'suspended') return 'Statement interrupted';
  return 'Before statement / instruction executes';
}

function details({description, frame, isCaller, point, match, breakpointsEnabled}) {
  let text = escapeHtml(description);
  if (isCaller) text += ' · Inspecting caller ' + escapeHtml(frame.name) + '; ⇢ is not the execution position.';
  if (point && !match) text += ' · Source unavailable or different from the assembly snapshot; source highlight withheld.';
  if (breakpointsEnabled === false) text += ' · All breakpoints muted.';
  return text;
}

/** Paint the stop banner using exact executing-source identity and the host's existing action callbacks. */
export function updateDebugStopBanner(host) {
  const {state, banner} = host;
  const debug = state.debug;
  banner.hidden = debug?.state !== 'paused';
  if (banner.hidden) return;
  const point = debug.point;
  const frame = [...(state.inspectedThreadFrames ?? []), ...(debug.frames ?? [])]
    .find(item => item.id === state.frameId);
  const isCaller = frame && frame.id !== debug.frames?.[0]?.id;
  const match = !!(point && workspaceFileForDebugSource(state, point.uri, point));
  const reason = debug.reason ?? {};
  const phase = phaseDescription(reason);
  const location = point ? `${point.uri}:${point.line}:${point.column}`
    : debug.frames?.[0]?.instructionPointerReference ?? 'No source mapping';
  const description = reason.description ?? reason.reason ?? 'Paused';
  const breakpointsEnabled = state.debugSettings.breakpointsEnabled;
  const key = JSON.stringify([description, location, phase, isCaller, frame?.id, match,
    reason.hitBreakpointIds, breakpointsEnabled]);
  if (host.bannerKey === key) return;
  host.bannerKey = key;
  banner.dataset.reason = reason.reason ?? 'pause';
  banner.dataset.phase = reason.phase ?? 'before';
  const title = reason.reason === 'entry' ? 'Entry stop (explicitly requested)' : reason.reason ?? 'Paused';
  banner.innerHTML = '<span class="debug-stop-arrow">➜</span><div><b>' + escapeHtml(title)
    + '</b> <span>' + escapeHtml(location) + ' · ' + escapeHtml(phase) + '</span><small>'
    + details({description, frame, isCaller, point, match, breakpointsEnabled})
    + '</small></div><button data-next>Show Next Statement</button>'
    + '<button data-settings title="Debugger settings">⚙</button>';
  banner.querySelector('[data-next]').onclick = host.showNext;
  banner.querySelector('[data-settings]').onclick = () => host.docking.activate('debug-session');
}
