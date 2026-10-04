import { generateCodeItem } from "./code.js";

export const order = 52;
export const template = Object.freeze({
  "id": "attribute",
  "name": "Attribute Class",
  "description": "C# attribute class with namespace and nullable options.",
  "category": "Code",
  "language": "C#",
  "platform": "SharpForge browser",
  "fileName": "CustomAttribute.cs",
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
