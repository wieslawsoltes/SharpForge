import { generateConfigFile } from "./config-files.js";

export const order = 43;
export const template = Object.freeze({
  "id": "launch-settings",
  "name": "Launch Settings",
  "description": "Generate launchSettings.json with explicit portable defaults.",
  "category": "Configuration",
  "language": "JSON",
  "platform": "SharpForge browser",
  "fileName": "launchSettings.json",
  "kind": "item",
  "targets": [
    "data"
  ],
  generate: generateConfigFile
});
