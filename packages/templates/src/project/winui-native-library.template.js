import { generateNativeWinui, windowsAppSdkVersion } from "./winui-native.js";

export const order = 35;
export const template = Object.freeze({
  "id": "winui-native-library",
  "name": "WinUI 3 Class Library",
  "description": "Windows App SDK project with real XAML compilation. Requires Windows, the Windows SDK, and package restore.",
  "category": "WinUI Native",
  "language": "C#",
  "platform": "Windows",
  "kind": "project",
  "nativeOnly": true,
  "nativeCompatible": true,
  "winui": true,
  "windowsOnly": true,
  "targets": [
    "windows-native"
  ],
  "qualification": {
    "windows-native": "pending"
  },
  "prerequisites": [
    "Windows 10 build 19041 or newer",
    ".NET SDK for selected framework",
    "Windows SDK 10.0.19041.0+",
    "Microsoft.WindowsAppSDK " + windowsAppSdkVersion
  ],
  generate: generateNativeWinui
});
