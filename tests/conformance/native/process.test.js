import test from "node:test";
import { processChecks } from "../../../scripts/conformance/native/process.js";
import { Unsupported } from "../../../scripts/conformance/native/contracts.js";
for (const [id, check] of Object.entries(processChecks)) {
  test("T10 actual host process: " + id, async (t) => {
    try {
      await check();
    } catch (error) {
      if (!(error instanceof Unsupported)) throw error;
      t.skip(error.message);
    }
  });
}
