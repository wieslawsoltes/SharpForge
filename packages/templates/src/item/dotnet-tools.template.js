import { generateConfigFile } from "./config-files.js";

export const order = 42;
export const template = Object.freeze({
  "id": "dotnet-tools",
  "name": "Local .NET Tools",
  "description": "Generate dotnet-tools.json with explicit portable defaults.",
  "category": "Configuration",
  "language": "JSON",
  "platform": "SharpForge browser",
  "fileName": "dotnet-tools.json",
  "kind": "item",
  "targets": [
    "data"
  ],
  generate: generateConfigFile
});
