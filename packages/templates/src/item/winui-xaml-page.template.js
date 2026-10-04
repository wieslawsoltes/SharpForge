import { generateXamlItem } from "./winui-xaml.js";

export const order = 58;
export const template = Object.freeze({
  "id": "winui-xaml-page",
  "name": "WinUI XAML Page",
  "description": "Native XAML and code-behind pair with explicit dependent-file metadata.",
  "category": "WinUI XAML",
  "language": "XAML",
  "platform": "Windows",
  "kind": "item",
  "windowsOnly": true,
  "nativeOnly": true,
  "targets": [
    "browser-designer",
    "windows-native"
  ],
  "prerequisites": [
    "Windows App SDK XAML compiler"
  ],
  "qualification": {
    "windows-native": "pending"
  },
  "fileName": "BlankPage.xaml",
  "xamlType": "Page",
  "designerCompatible": true,
  generate: generateXamlItem
});
