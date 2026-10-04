import { generateMvvmItem } from "./winui-mvvm.js";

export const order = 72;
export const template = Object.freeze({
  "id": "winui-mvvm-shell",
  "name": "MVVM Navigation Shell",
  "description": "NavigationView, Home and Settings pages, observable model and commands wired end to end.",
  "category": "WinUI MVVM",
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
  "fileName": "ShellPage.xaml",
  generate: generateMvvmItem
});
