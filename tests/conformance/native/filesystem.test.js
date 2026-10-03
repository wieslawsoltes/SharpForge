import test from "node:test";
import { filesystemChecks } from "../../../scripts/conformance/native/filesystem.js";
for (const [id, check] of Object.entries(filesystemChecks)) {
  test("T10 actual host filesystem: " + id, check);
}
