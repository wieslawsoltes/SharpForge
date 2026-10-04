import { generateXamlItem } from "./winui-xaml.js";

export const order = 59;
export const template = Object.freeze({
  "id": "winui-xaml-window",
  "name": "WinUI XAML Window",
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
  "fileName": "BlankWindow.xaml",
  "xamlType": "Window",
  "designerCompatible": true,
  generate: generateXamlItem
});
