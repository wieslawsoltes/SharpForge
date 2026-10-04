import { generateCodeItem } from "./code.js";

export const order = 55;
export const template = Object.freeze({
  "id": "xunit-test-class",
  "name": "xunit Test Class",
  "description": "A passing native test class with the required package references.",
  "category": "Tests",
  "language": "C#",
  "platform": "SharpForge browser",
  "fileName": "UnitTest1.cs",
  "kind": "item",
  "nativeOnly": true,
  "targets": [
    "native-dotnet"
  ],
  "prerequisites": [
    "Native .NET SDK and test framework packages"
  ],
  generate: generateCodeItem
});
