import { generateConfigFile } from "./config-files.js";

export const order = 39;
export const template = Object.freeze({
  "id": "gitignore-dotnet",
  "name": ".NET Git Ignore",
  "description": "Generate .gitignore with explicit portable defaults.",
  "category": "Configuration",
  "language": "Text",
  "platform": "SharpForge browser",
  "fileName": ".gitignore",
  "kind": "item",
  "targets": [
    "data"
  ],
  generate: generateConfigFile
});
