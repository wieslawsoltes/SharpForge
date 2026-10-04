import { generateConfigFile } from "./config-files.js";

export const order = 38;
export const template = Object.freeze({
  "id": "nuget-config",
  "name": "NuGet Configuration",
  "description": "Generate nuget.config with explicit portable defaults.",
  "category": "Configuration",
  "language": "XML",
  "platform": "SharpForge browser",
  "fileName": "nuget.config",
  "kind": "item",
  "targets": [
    "data"
  ],
  generate: generateConfigFile
});
