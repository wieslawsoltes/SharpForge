import { createPart, registerFamily, stateFor, controlName, ControlError } from '../policy/events.js';
import { HostPermissionPolicy, reportControlFailure } from '../policy/capabilities.js';
import { WriteableBitmap, drawNineGrid } from './image-source.js';

export function resolveImageSource(context, value) {
  if (value?.$ref) return context.nodes.get(value.$ref)?.properties ?? null;
  return value;
}

function renderImage(context, node, element) {
  const properties = node.properties;
  const source = resolveImageSource(context, properties.ImageSource ?? properties.Source);
  const state = stateFor(context, node, 'image', () => ({ uri: null, revision: -1, failed: false }));
  const [image, canvas] = element.children;
  image.hidden = source instanceof WriteableBitmap || !!source?.PixelBuffer;
  canvas.hidden = !image.hidden && !properties.NineGrid;
  image.style.objectFit = ['none', 'fill', 'contain', 'cover'][properties.Stretch ?? 2];
  image.alt = properties.AlternativeText ?? properties.AutomationName ?? '';
  image.style.width = image.style.height = '100%';
  if (image.hidden) {
    if (!Number.isInteger(source.PixelWidth) || !Number.isInteger(source.PixelHeight) || source.PixelWidth < 1
      || source.PixelHeight < 1 || source.PixelWidth * source.PixelHeight > 16_777_216
      || source.PixelBuffer?.length !== source.PixelWidth * source.PixelHeight * 4) {
      throw new ControlError('SFUI16B3', 'Invalid or oversized image pixel buffer');
    }
    const revision = source.Revision ?? source.revision ?? 0;
    if (state.revision === revision) return;
    canvas.width = source.PixelWidth;
    canvas.height = source.PixelHeight;
    const graphics = canvas.getContext('2d');
    const data = graphics.createImageData(canvas.width, canvas.height);
    data.data.set(source.PixelBuffer);
    graphics.putImageData(data, 0, 0);
    state.revision = revision;
    return;
  }
  const value = typeof source === 'string' ? source : source?.UriSource ?? '';
  if (value === state.uri) return;
  state.uri = value;
  state.failed = false;
  if (!value) { image.removeAttribute('src'); return; }
  try {
    const policy = context.services.permissions ?? new HostPermissionPolicy();
    image.src = policy.url(value, { capability: 'image', image: true });
    if (source?.DecodePixelWidth > 0) image.width = source.DecodePixelWidth;
    if (source?.DecodePixelHeight > 0) image.height = source.DecodePixelHeight;
  } catch (error) {
    image.removeAttribute('src');
    state.failed = true;
    context.emit(node, 'ImageFailed', { ErrorMessage: error.message, Code: error.code });
  }
}

function imageEvent(context, node, element, event) {
  if (event.type === 'error') { context.emit(node, 'ImageFailed', { ErrorMessage: 'The image could not be decoded', Code: 'SFUI16B3' }); return true; }
  const image = element.firstChild;
  const source = resolveImageSource(context, node.properties.ImageSource ?? node.properties.Source);
  if (source && typeof source === 'object') { source.PixelWidth = image.naturalWidth; source.PixelHeight = image.naturalHeight; }
  if (node.properties.NineGrid) {
    const canvas = element.lastChild;
    canvas.width = element.clientWidth || image.naturalWidth;
    canvas.height = element.clientHeight || image.naturalHeight;
    drawNineGrid(canvas.getContext('2d'), image, canvas.width, canvas.height, node.properties.NineGrid);
    image.hidden = true;
    canvas.hidden = false;
  }
  context.emit(node, 'ImageOpened', { PixelWidth: image.naturalWidth, PixelHeight: image.naturalHeight });
  return true;
}

export function registerImageRenderers(registry) {
  registerFamily(registry, ['Image', 'ImageIcon', 'BitmapIcon'], { create(context) {
    const root = context.document.createElement('div');
    root.append(createPart(context.document, 'img', 'image-source'), createPart(context.document, 'canvas', 'image-pixels'));
    return root;
  }, render: renderImage, events: { load: imageEvent, error: imageEvent } });
  registerFamily(registry, 'PersonPicture', { create(context) {
    const root = context.document.createElement('div');
    const photo = createPart(context.document, 'div', 'person-photo');
    photo.append(createPart(context.document, 'img', 'image-source'), createPart(context.document, 'canvas', 'image-pixels'));
    root.append(photo, createPart(context.document, 'span', 'person-initials'), createPart(context.document, 'span', 'person-badge'));
    return root;
  },
    render(context, node, element) {
      const properties = node.properties;
      const [photo, initials, badge] = element.children;
      const state = stateFor(context, node, 'person', () => ({ failed: null }));
      const source = properties.ProfilePicture;
      photo.hidden = !!properties.IsGroup || !source || state.failed === source;
      initials.hidden = !photo.hidden;
      if (!photo.hidden) {
        renderImage(context, { ...node, properties: { ...properties, ImageSource: source, Stretch: 3 } }, photo);
        if (stateFor(context, node, 'image').failed) {
          state.failed = source;
          photo.hidden = true;
          initials.hidden = false;
        }
      }
      initials.textContent = properties.IsGroup ? '👥' : properties.Initials || personInitials(properties.DisplayName) || '👤';
      badge.textContent = properties.BadgeNumber > 0 ? properties.BadgeNumber > 99 ? '99+' : String(properties.BadgeNumber)
        : properties.BadgeGlyph || properties.BadgeText || '';
      badge.hidden = !badge.textContent;
      badge.setAttribute('aria-label', properties.BadgeText || (properties.BadgeNumber > 0 ? `${properties.BadgeNumber} notifications` : ''));
      element.setAttribute('role', 'img');
      element.setAttribute('aria-label', properties.DisplayName ?? 'Person');
      element.style.borderRadius = '50%';
      photo.style.borderRadius = 'inherit';
      photo.style.overflow = 'hidden';
    }, events: {
      load(context, node, element, event) { return imageEvent(context, node, element.firstChild, event); },
      error(context, node, element, event) {
        stateFor(context, node, 'person', () => ({ failed: null })).failed = node.properties.ProfilePicture;
        context.invalidate(node.id);
        return imageEvent(context, node, element.firstChild, event);
      }
    }
  });
}

/** Latin, Greek and Cyrillic display-name initials; complex-script callers can supply Initials explicitly. */
export function personInitials(value = '') {
  const names = String(value).trim().split(/\s+/u).filter(Boolean);
  if (!names.length) return '';
  const letters = [names[0], ...(names.length > 1 ? [names.at(-1)] : [])].map(name => [...name][0]);
  return letters.every(letter => /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u.test(letter))
    ? letters.join('').toLocaleUpperCase() : '';
}
