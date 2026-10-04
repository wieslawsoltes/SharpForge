import { generateCodeItem } from "./code.js";

export const order = 49;
export const template = Object.freeze({
  "id": "enum",
  "name": "Enum",
  "description": "C# enum with namespace and nullable options.",
  "category": "Code",
  "language": "C#",
  "platform": "SharpForge browser",
  "fileName": "Status.cs",
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
