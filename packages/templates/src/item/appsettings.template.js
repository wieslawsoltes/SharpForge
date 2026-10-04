import { generateConfigFile } from "./config-files.js";

export const order = 45;
export const template = Object.freeze({
  "id": "appsettings",
  "name": "Application Settings",
  "description": "Generate appsettings.json with explicit portable defaults.",
  "category": "Configuration",
  "language": "JSON",
  "platform": "SharpForge browser",
  "fileName": "appsettings.json",
  "kind": "item",
  "targets": [
    "data"
  ],
  generate: generateConfigFile
});
