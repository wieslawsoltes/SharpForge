import { generateAnimationItem } from "./winui-animation.js";

export const order = 67;
export const template = Object.freeze({
  "id": "winui-storyboard-code",
  "name": "Opacity Storyboard (code-first)",
  "description": "A working DoubleAnimation factory using the portable animation clock.",
  "category": "WinUI",
  "language": "C#",
  "platform": "SharpForge browser",
  "kind": "item",
  "fileName": "FadeAnimation.cs",
  "winui": true,
  "targets": [
    "browser-managed",
    "windows-native"
  ],
  generate: generateAnimationItem
});
