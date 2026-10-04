import { generateCodeItem } from "./code.js";

export const order = 54;
export const template = Object.freeze({
  "id": "top-level-program",
  "name": "Top-level Program",
  "description": "Executable top-level statements; the selected project must have a single entry point.",
  "category": "Code",
  "language": "C#",
  "platform": "SharpForge browser",
  "fileName": "Program.cs",
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
