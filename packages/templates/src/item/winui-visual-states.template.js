import { generateAnimationItem } from "./winui-animation.js";

export const order = 70;
export const template = Object.freeze({
  "id": "winui-visual-states",
  "name": "Visual States",
  "description": "Native WinUI animation markup with explicit target names.",
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
  "fileName": "StatePage.xaml",
  generate: generateAnimationItem
});
