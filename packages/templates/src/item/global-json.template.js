import { generateConfigFile } from "./config-files.js";

export const order = 37;
export const template = Object.freeze({
  "id": "global-json",
  "name": "SDK Version Policy",
  "description": "Generate global.json with explicit portable defaults.",
  "category": "Configuration",
  "language": "JSON",
  "platform": "SharpForge browser",
  "fileName": "global.json",
  "kind": "item",
  "targets": [
    "data"
  ],
  generate: generateConfigFile
});
