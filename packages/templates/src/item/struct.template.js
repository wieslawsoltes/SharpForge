import { generateCodeItem } from "./code.js";

export const order = 48;
export const template = Object.freeze({
  "id": "struct",
  "name": "Struct",
  "description": "C# struct with namespace and nullable options.",
  "category": "Code",
  "language": "C#",
  "platform": "SharpForge browser",
  "fileName": "Struct1.cs",
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
