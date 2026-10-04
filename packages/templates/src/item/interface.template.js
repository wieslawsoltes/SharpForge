import { generateCodeItem } from "./code.js";

export const order = 46;
export const template = Object.freeze({
  "id": "interface",
  "name": "Interface",
  "description": "C# interface with namespace and nullable options.",
  "category": "Code",
  "language": "C#",
  "platform": "SharpForge browser",
  "fileName": "IService.cs",
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
