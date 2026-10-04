import { generateConfigFile } from "./config-files.js";

export const order = 41;
export const template = Object.freeze({
  "id": "central-packages",
  "name": "Central Package Versions",
  "description": "Generate Directory.Packages.props with explicit portable defaults.",
  "category": "Configuration",
  "language": "XML",
  "platform": "SharpForge browser",
  "fileName": "Directory.Packages.props",
  "kind": "item",
  "targets": [
    "data"
  ],
  generate: generateConfigFile
});
