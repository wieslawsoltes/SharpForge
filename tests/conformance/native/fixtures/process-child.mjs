import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [mode, marker] = process.argv.slice(2);
if (mode === "tree") {
  const child = spawn(process.execPath, [import.meta.filename, "wait"], {
    stdio: "ignore",
  });
  writeFileSync(
    marker,
    JSON.stringify({ parent: process.pid, child: child.pid }),
  );
  setInterval(() => {}, 1000);
} else if (mode === "signal") {
  process.on("SIGTERM", () => {
    writeFileSync(marker + ".closed", "disposed");
    process.exit(0);
  });
  writeFileSync(marker, String(process.pid));
  setInterval(() => {}, 1000);
} else if (mode === "wait") setInterval(() => {}, 1000);
else throw new Error("Unknown process fixture");
