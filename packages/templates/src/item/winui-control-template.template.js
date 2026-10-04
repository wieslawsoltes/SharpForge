import { generateControlItem } from "./winui-controls.js";

export const order = 65;
export const template = Object.freeze({
  "id": "winui-control-template",
  "name": "Control Template",
  "description": "Native WinUI resources with unique keys and supported markup.",
  "category": "WinUI XAML",
  "language": "XAML",
  "platform": "Windows",
  "kind": "item",
  "windowsOnly": true,
  "nativeOnly": true,
  "targets": [
    "windows-native"
  ],
  "prerequisites": [
    "Windows App SDK XAML compiler"
  ],
  "qualification": {
    "windows-native": "pending"
  },
  "fileName": "ButtonTemplate.xaml",
  generate: generateControlItem
});
