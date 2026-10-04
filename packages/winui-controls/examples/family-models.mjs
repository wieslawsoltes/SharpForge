import {
  SelectionModel, SelectionMode, TextBuffer, NavigationFrame, NumericRange,
  ResourceLoader, DataPackage, createControlServices
} from '@sharpforge/winui-controls';

const output = {};
const shared = { label: 'shared occurrence' };
const first = { label: 'first' };
const selection = new SelectionModel({ items: [first, shared, shared], mode: SelectionMode.Extended });
selection.select(2);
selection.setItems([{ label: 'inserted' }, shared, first, shared]);
output.selection = { index: selection.selectedIndex, item: selection.selectedItem.label, count: selection.count };

const text = new TextBuffer({ text: 'alpha', now: () => 0 });
text.on('BeforeTextChanging', args => { if (args.NewText.includes('!')) args.Cancel = true; });
text.selectAll();
text.insert('beta');
output.cancelledEdit = !text.insert('!');
text.undo();
output.undo = text.text;

let pages = 0;
const frame = new NavigationFrame({ factory: type => ({ type, NavigationCacheMode: 1, instance: ++pages }) });
frame.navigate('Home', 'first launch');
const home = frame.content;
frame.navigate('Details', 42);
frame.goBack();
output.navigation = { type: frame.content.type, cached: frame.content === home, parameter: frame.current.parameter };

const range = new NumericRange({ minimum: 0, maximum: 10, value: 8, largeChange: 5 });
range.step(1, true);
output.range = { value: range.value, fraction: range.fraction };

const resources = new ResourceLoader({ resources: {
  'en-US': { 'Heading.Text': 'Control models' }, de: { 'Heading.Text': 'Steuerelementmodelle' }
} });
const heading = {};
const binding = resources.bindUid('Heading', (property, value) => { heading[property] = value; });
resources.setLanguage('de-DE');
output.localization = { text: heading.Text, missing: resources.getString('NotPresent') };

const services = createControlServices({ permissionPolicy: { request: async () => false } });
const packageData = new DataPackage();
packageData.setText('This sample never accesses the OS clipboard.');
output.clipboard = await services.clipboard.setContent(packageData);

console.log(JSON.stringify(output, null, 2));
binding.dispose();
resources.dispose();
selection.dispose();
text.dispose();
frame.dispose();
range.dispose();
services.dispose();
