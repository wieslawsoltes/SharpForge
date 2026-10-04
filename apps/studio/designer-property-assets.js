import {designerAssets, designerAssetUri} from '../../packages/designer/src/index.js';
import {propertyButton, propertyDialog, propertyElement, propertyInput} from './designer-property-dom.js';

export function openDesignerAssetPicker(context) {
  const modal = propertyDialog(context.document, 'Choose project image');
  const search = propertyInput(context.document, {label: 'Search image assets', placeholder: 'Search image assets'});
  const list = propertyElement(context.document, 'div', '', 'design-asset-grid');
  modal.body.append(search, list);
  let generation = 0;
  const render = () => {
    const current = ++generation;
    list.replaceChildren();
    const assets = designerAssets(context.view.records(), {search: search.value});
    for (const asset of assets) {
      const button = propertyButton(context.document, '', () => modal.run(async () => {
        if (!context.view.assetPreviews) throw new Error('The project asset preview service is unavailable.');
        await context.view.assetPreviews.preview(asset);
        context.commit(designerAssetUri(asset.path));
        modal.close();
      }), {title: asset.path});
      button.className = 'design-asset-item';
      const image = context.document.createElement('img');
      image.alt = asset.name;
      image.width = 80;
      image.height = 64;
      const label = propertyElement(context.document, 'span', asset.path);
      button.append(image, label);
      list.append(button);
      if (context.view.assetPreviews) {
        context.view.assetPreviews.preview(asset).then(url => {
          if (current === generation && image.isConnected) image.src = url;
        }).catch(error => { if (current === generation) label.textContent = asset.path + ' · ' + error.message; });
      }
    }
    if (!assets.length) list.append(propertyElement(context.document, 'p', 'No matching images in this project.'));
  };
  search.addEventListener('input', () => modal.run(render));
  modal.run(render);
  return modal;
}

export function assetPropertyEditor(context) {
  const root = propertyElement(context.document, 'div', '', 'design-asset-editor');
  const input = propertyInput(context.document, {value: context.mixed ? '' : context.text,
    placeholder: context.mixed ? 'Mixed' : 'Project image URI', label: context.name});
  input.dataset.property = context.name;
  input.addEventListener('change', () => context.run(() => context.commit(input.value)));
  root.append(input, propertyButton(context.document, 'Browse…', () => context.run(() => openDesignerAssetPicker(context))));
  const source = context.view.assetPreviews?.resolve(context.value);
  if (source) {
    const preview = context.document.createElement('img');
    preview.alt = 'Selected image';
    preview.src = source;
    preview.className = 'design-asset-selected';
    root.append(preview);
  }
  return root;
}
