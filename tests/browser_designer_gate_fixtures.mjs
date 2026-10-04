export const sourceUri = 'Dashboard.cs';
export const designUri = 'Preview.sfdesign.json';
export const largeUri = 'Large.sfdesign.json';

export const source = `using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
class Dashboard
{
    public static Window Create()
    {
        var window = new Window() { Title = "Browser qualification" };
        var canvas = new Canvas() { Width = 960, Height = 640 };
        // User-owned comment: geometry edits must preserve this line.
        var action = new Button() { Name = "Action", Content = "Initial", Width = 160, Height = 40 };
        Canvas.SetLeft(action, 48);
        Canvas.SetTop(action, 64);
        canvas.Children.Add(action);
        window.Content = canvas;
        return window;
    }
}
`;

export const component = `using Microsoft.UI.Xaml.Controls;
class Card : UserControl
{
    public Card()
    {
        var body = new StackPanel();
        var title = new TextBlock() { Name = "CardTitle", Text = "Nested component content", FontSize = 18 };
        body.Children.Add(title);
        this.Content = body;
    }
}
`;

export function componentRecords() {
  const nested = source.replace('canvas.Children.Add(action);', `canvas.Children.Add(action);
        var card = new Card() { Name = "NestedCard", Width = 300, Height = 100 };
        Canvas.SetLeft(card, 240);
        Canvas.SetTop(card, 64);
        canvas.Children.Add(card);`);
  return [{path: sourceUri, text: nested}, {path: 'Card.cs', text: component}, programRecord];
}

export const programRecord = {path: 'Program.cs', text: 'class Program { static void Main() {} }'};
export const sourceRecords = [{path: sourceUri, text: source}, programRecord];

const solid = color => ({valueType: 'Microsoft.UI.Xaml.Media.SolidColorBrush',
  Color: {valueType: 'Windows.UI.Color', A: 255, ...color}, Opacity: 1});

export function previewDesign() {
  return {version: 1, name: 'Preview authoring', width: 960, height: 640, root: 'window',
    nodes: [
      {id: 'window', type: 'Window', properties: {Title: 'Preview authoring'}, children: ['canvas']},
      {id: 'canvas', type: 'Canvas', properties: {Width: 960, Height: 640}, children: ['action', 'picture']},
      {id: 'action', type: 'Button', properties: {Name: 'Action', Content: 'Preview', Left: 48, Top: 64, Width: 160, Height: 40},
        resourceReferences: {Background: {kind: 'theme', key: 'AccentBrush'}}, style: 'Accent', children: []},
      {id: 'picture', type: 'Image', properties: {Name: 'Picture', Left: 48, Top: 144, Width: 96, Height: 64}, children: []}
    ], styles: {Accent: {targetType: 'Button', setters: {FontSize: 15}}}, templates: {}, resources: {
      AccentBrush: {kind: 'theme', type: 'Microsoft.UI.Xaml.Media.Brush', variants: {
        default: solid({R: 32, G: 64, B: 128}), light: solid({R: 160, G: 32, B: 16}), dark: solid({R: 16, G: 96, B: 48})
      }}
    }};
}

export function previewRecords() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16">' +
    '<rect width="24" height="16" fill="#1264a3"/></svg>';
  return [{path: designUri, text: JSON.stringify(previewDesign())}, {path: 'Assets/Badge.svg', text: svg}, programRecord];
}

/** Exactly 5000 authored nodes, including the root and Canvas; all controls have real DOM-backed runtime instances. */
export function largeDesign() {
  const children = Array.from({length: 4998}, (_, index) => ({
    id: `item${index}`, type: 'Button', children: [],
    properties: {Name: `Item${index}`, Content: String(index), Left: index % 50 * 18, Top: Math.floor(index / 50) * 6,
      Width: 16, Height: 5}
  }));
  Object.assign(children[255].properties, {Content: 'Drag target', Left: 80, Top: 620, Width: 140, Height: 40});
  return {version: 1, name: '5000-node interaction', width: 960, height: 800, root: 'window', styles: {}, templates: {},
    nodes: [{id: 'window', type: 'Window', properties: {Title: '5000 nodes'}, children: ['canvas']},
      {id: 'canvas', type: 'Canvas', properties: {Width: 960, Height: 800}, children: children.map(node => node.id)}, ...children]};
}
