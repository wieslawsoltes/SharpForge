import { generateCodeItem } from "./code.js";

export const order = 47;
export const template = Object.freeze({
  "id": "record",
  "name": "Record",
  "description": "C# record with namespace and nullable options.",
  "category": "Code",
  "language": "C#",
  "platform": "SharpForge browser",
  "fileName": "Record1.cs",
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
