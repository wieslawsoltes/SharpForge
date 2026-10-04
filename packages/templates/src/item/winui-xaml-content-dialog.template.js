import { generateXamlItem } from "./winui-xaml.js";

export const order = 61;
export const template = Object.freeze({
  "id": "winui-xaml-content-dialog",
  "name": "WinUI XAML ContentDialog",
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
  "fileName": "BlankContentDialog.xaml",
  "xamlType": "ContentDialog",
  "designerCompatible": true,
  generate: generateXamlItem
});
