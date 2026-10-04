import { generateConfigFile } from "./config-files.js";

export const order = 40;
export const template = Object.freeze({
  "id": "gitattributes",
  "name": "Git Attributes",
  "description": "Generate .gitattributes with explicit portable defaults.",
  "category": "Configuration",
  "language": "Text",
  "platform": "SharpForge browser",
  "fileName": ".gitattributes",
  "kind": "item",
  "targets": [
    "data"
  ],
  generate: generateConfigFile
});
