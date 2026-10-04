import { generateCodeItem } from "./code.js";

export const order = 51;
export const template = Object.freeze({
  "id": "exception",
  "name": "Exception Class",
  "description": "C# exception class with namespace and nullable options.",
  "category": "Code",
  "language": "C#",
  "platform": "SharpForge browser",
  "fileName": "CustomException.cs",
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
