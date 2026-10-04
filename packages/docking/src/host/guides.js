import { DOCK_SIDES } from '../model/nodes.js';

const labels = { left: '←', right: '→', top: '↑', bottom: '↓', center: '▣' };

/** Computes exactly nine explicit targets in CSS pixels; points outside targets never imply a dock. */
export function dockGuideTargets(group, host, { size = 40, gap = 4 } = {}) {
  const centerX = group.left + group.width / 2;
  const centerY = group.top + group.height / 2;
  const offsets = { center: [0, 0], left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
  const targets = Object.entries(offsets).map(([side, [x, y]]) => ({
    id: `group-${side}`, scope: 'group', side,
    left: centerX - size / 2 + x * (size + gap), top: centerY - size / 2 + y * (size + gap), width: size, height: size
  }));
  const edgeOffset = size / 2 + gap;
  for (const side of DOCK_SIDES) {
    const x = side === 'left' ? host.left + edgeOffset : side === 'right' ? host.left + host.width - edgeOffset : host.left + host.width / 2;
    const y = side === 'top' ? host.top + edgeOffset : side === 'bottom' ? host.top + host.height - edgeOffset : host.top + host.height / 2;
    targets.push({ id: `root-${side}`, scope: 'root', side, left: x - size / 2, top: y - size / 2, width: size, height: size });
  }
  return targets;
}

export function hitDockGuide(targets, x, y) {
  return targets.find(item => x >= item.left && x <= item.left + item.width && y >= item.top && y <= item.top + item.height) ?? null;
}

/** DOM overlay with an explicit geometry contract shared by pointer, HTML drag and keyboard docking. */
export class DockGuideOverlay {
  constructor(host) {
    this.host = host;
    this.element = null;
    this.group = null;
    this.targets = [];
    this.active = null;
  }

  show(group) {
    if (!group) return;
    const rootBounds = this.host.element.getBoundingClientRect();
    this.group = group;
    this.targets = dockGuideTargets(group.getBoundingClientRect(), rootBounds);
    if (!this.element) {
      this.element = this.host.el('div', 'sf-dock-guides');
      this.element.setAttribute('aria-label', 'Dock targets');
      this.element.setAttribute('role', 'group');
      this.host.element.append(this.element);
    }
    this.element.replaceChildren();
    this.shade = this.host.el('div', 'sf-dock-guide-preview');
    this.shade.hidden = true;
    this.element.append(this.shade);
    for (const target of this.targets) {
      const button = this.host.button(labels[target.side], `Dock ${target.scope === 'root' ? 'workspace ' : ''}${target.side}`, () => {
        this.active = target;
        this.host.dropDrag(target, group.dataset.dockGroup);
      });
      button.classList.add('sf-dock-guide-target');
      button.dataset.dockTarget = target.id;
      button.dataset.dockSide = target.side;
      button.dataset.dockScope = target.scope;
      Object.assign(button.style, { left: `${target.left - rootBounds.left}px`, top: `${target.top - rootBounds.top}px`,
        width: `${target.width}px`, height: `${target.height}px` });
      button.ondragover = event => {
        event.preventDefault();
        event.stopPropagation();
        this.select(target);
      };
      button.ondrop = event => {
        event.preventDefault();
        event.stopPropagation();
        this.host.readDrag(event);
        this.host.dropDrag(target, group.dataset.dockGroup);
      };
      this.element.append(button);
    }
  }

  update(group, event) {
    if (group !== this.group || !this.element?.isConnected) this.show(group);
    const target = hitDockGuide(this.targets, event.clientX, event.clientY);
    this.select(target);
    return target;
  }

  select(target) {
    this.active = target;
    if (!this.element) return;
    for (const button of this.element.querySelectorAll('[data-dock-target]')) {
      button.classList.toggle('active', button.dataset.dockTarget === target?.id);
    }
    this.shade.hidden = !target;
    if (!target) return;
    const host = this.host.element.getBoundingClientRect();
    const bounds = target.scope === 'root' ? host : this.group.getBoundingClientRect();
    let { left, top, width, height } = bounds;
    if (target.side === 'left' || target.side === 'right') width /= 2;
    if (target.side === 'top' || target.side === 'bottom') height /= 2;
    if (target.side === 'right') left += width;
    if (target.side === 'bottom') top += height;
    Object.assign(this.shade.style, { left: `${left - host.left}px`, top: `${top - host.top}px`, width: `${width}px`, height: `${height}px` });
  }

  clear() {
    this.element?.remove();
    this.element = null;
    this.group = null;
    this.active = null;
    this.targets = [];
  }
}
