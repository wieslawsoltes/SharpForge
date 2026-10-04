import { generateConfigFile } from "./config-files.js";

export const order = 44;
export const template = Object.freeze({
  "id": "app-manifest",
  "name": "Windows Application Manifest",
  "description": "Generate app.manifest with explicit portable defaults.",
  "category": "Configuration",
  "language": "XML",
  "platform": "SharpForge browser",
  "fileName": "app.manifest",
  "kind": "item",
  "targets": [
    "data"
  ],
  generate: generateConfigFile
});
