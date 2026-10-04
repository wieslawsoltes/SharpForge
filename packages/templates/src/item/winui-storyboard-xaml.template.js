import { generateAnimationItem } from "./winui-animation.js";

export const order = 68;
export const template = Object.freeze({
  "id": "winui-storyboard-xaml",
  "name": "XAML Storyboard",
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
  "fileName": "FadeStoryboard.xaml",
  generate: generateAnimationItem
});
