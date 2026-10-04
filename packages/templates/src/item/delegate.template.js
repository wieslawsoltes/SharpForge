import { generateCodeItem } from "./code.js";

export const order = 50;
export const template = Object.freeze({
  "id": "delegate",
  "name": "Delegate",
  "description": "C# delegate with namespace and nullable options.",
  "category": "Code",
  "language": "C#",
  "platform": "SharpForge browser",
  "fileName": "ChangedHandler.cs",
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
