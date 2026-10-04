import { generateAnimationItem } from "./winui-animation.js";

export const order = 69;
export const template = Object.freeze({
  "id": "winui-theme-transition",
  "name": "Theme Transition",
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
  "fileName": "TransitionPage.xaml",
  generate: generateAnimationItem
});
