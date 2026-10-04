import { generateTestProject } from "./tests.js";

export const order = 32;
export const template = Object.freeze({
  "id": "mstest",
  "name": "MSTest Test Project",
  "description": "SDK test project with pinned packages and one passing test. Requires native dotnet restore and dotnet test.",
  "category": "Tests",
  "language": "C#",
  "platform": ".NET SDK",
  "nativeOnly": true,
  "nativeCompatible": true,
  "targets": [
    "native-dotnet"
  ],
  "kind": "project",
  "prerequisites": [
    ".NET SDK for the selected target framework",
    "NuGet restore access or populated package cache"
  ],
  "qualification": {
    "native-dotnet": "pending"
  },
  generate: generateTestProject
});
