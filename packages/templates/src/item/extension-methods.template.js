import { generateCodeItem } from "./code.js";

export const order = 53;
export const template = Object.freeze({
  "id": "extension-methods",
  "name": "Extension Methods",
  "description": "C# extension methods with namespace and nullable options.",
  "category": "Code",
  "language": "C#",
  "platform": "SharpForge browser",
  "fileName": "Extensions.cs",
  "kind": "item",
  "nativeOnly": true,
  "targets": [
    "native-dotnet"
  ],
  "prerequisites": [
    "Native .NET SDK"
  ],
  generate: generateCodeItem
});
