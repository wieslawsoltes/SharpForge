import assert from "node:assert/strict";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  NativeWorkspace,
  startMSBuildHost,
} from "../../../packages/msbuild/src/node.js";
import { runProcess } from "../oracle/process.js";
import { run, temporary } from "../repro/common.js";
import { root, Unsupported } from "./contracts.js";

export const childFixture = join(
  root,
  "tests/conformance/native/fixtures/process-child.mjs",
);
export async function waitForFile(path, { timeout = 15000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await delay(30);
  }
  throw new Error("Native process did not create readiness marker: " + path);
}
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
export async function assertReaped(pids) {
  const deadline = Date.now() + 10000;
  while (pids.some(isAlive) && Date.now() < deadline) await delay(50);
  assert.deepEqual(
    pids.filter(isAlive),
    [],
    "Owned native process tree must be fully reaped",
  );
}
export async function cli(args, directory, options = {}) {
  return runProcess(
    process.execPath,
    [join(root, "apps/cli/main.js"), ...args],
    { cwd: directory, ...options },
  );
}
export async function readOnly(directory, callback) {
  if (process.platform !== "win32") {
    if (process.getuid?.() === 0)
      throw new Unsupported(
        "Root bypasses POSIX discretionary directory permissions",
      );
    await chmod(directory, 0o555);
    try {
      return await callback("posix-mode-0555");
    } finally {
      await chmod(directory, 0o755);
    }
  }
  const identity = await run("whoami", ["/user", "/fo", "csv", "/nh"]);
  const sid = identity.stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
  assert(sid, "Current Windows SID must be observable");
  await run("icacls", [directory, "/deny", `*${sid}:(OI)(CI)(W)`]);
  try {
    return await callback("windows-explicit-write-deny-acl");
  } finally {
    await run("icacls", [directory, "/remove:d", `*${sid}`]);
  }
}
export const processChecks = {
  "cli-success-malformed-and-managed-exit-boundaries": () =>
    temporary(async (directory) => {
      await writeFile(
        join(directory, "Exit.cs"),
        "class P { static int Main() { return 42; } }",
      );
      let result = await cli(["run", "Exit.cs"], directory);
      assert.equal(result.exitCode, 42, result.stderr);
      result = await cli(["check", "Exit.cs"], directory);
      assert.equal(result.exitCode, 0, result.stderr);
      await writeFile(join(directory, "Bad.cs"), "class {");
      result = await cli(["check", "Bad.cs"], directory);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /error/);
      result = await cli(
        ["compile", "Exit.cs", "--max-instructions", "0"],
        directory,
      );
      assert.equal(result.exitCode, 1);
      result = await cli(
        ["new", "console", "--name", "Example", "-o", join(directory, "new")],
        directory,
      );
      assert.equal(result.exitCode, 0, result.stderr);
      result = await cli(
        ["new", "console", "-o", join(directory, "new")],
        directory,
      );
      assert.equal(result.exitCode, 1);
      return {
        analysisSuccess: 0,
        malformed: 1,
        invalidOption: 1,
        outputConflict: 1,
        managedExit: 42,
      };
    }),
  "real-directory-permission-failure-is-cli-exit-one": () =>
    temporary(async (directory) => {
      const denied = join(directory, "denied");
      await mkdir(denied);
      await writeFile(join(directory, "Program.cs"), "return 0;");
      return readOnly(denied, async (policy) => {
        await assert.rejects(
          writeFile(join(denied, "probe.txt"), "not permitted"),
          /EACCES|EPERM/,
        );
        const result = await cli(
          ["compile", "Program.cs", "-o", join(denied, "Program.dll")],
          directory,
        );
        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, /EACCES|EPERM|permission/i);
        await assert.rejects(access(join(denied, "Program.dll")), {
          code: "ENOENT",
        });
        const workspace = await NativeWorkspace.open(denied);
        await assert.rejects(
          workspace.save([{ path: "new.txt", text: "x", expectedHash: null }]),
          /EACCES|EPERM/,
        );
        return { policy, cliExitCode: result.exitCode, noOutput: true };
      });
    }),
  "loopback-real-http-token-origin-host-and-disposal": () =>
    temporary(async (directory) => {
      await writeFile(join(directory, "File.txt"), "value");
      const host = await startMSBuildHost({ root: directory, port: 0 });
      const headers = {
        Authorization: "Bearer " + host.token,
        Origin: host.origin,
      };
      const url = host.origin + "/api/msbuild/workspace";
      try {
        assert.equal((await fetch(url)).status, 401);
        assert.equal(
          (
            await fetch(url, {
              headers: { ...headers, Authorization: "Bearer bad" },
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await fetch(url, {
              headers: { ...headers, Origin: "https://untrusted.example" },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await fetch(url, {
              headers: { ...headers, Host: "untrusted.example" },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await fetch(url, {
              headers: { ...headers, "Sec-Fetch-Site": "cross-site" },
            })
          ).status,
          403,
        );
        const accepted = await fetch(url, { headers });
        assert.equal(accepted.status, 200);
        const bytes = await accepted.text();
        assert(!bytes.includes(host.token));
        const malformed = await fetch(host.origin + "/api/msbuild/files", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: "{",
        });
        assert.equal(malformed.status, 400);
        const untrusted = await fetch(host.origin + "/api/msbuild/jobs", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            project: "No.csproj",
            action: "build",
            trusted: false,
          }),
        });
        assert.equal(untrusted.status, 403);
      } finally {
        await host.close();
      }
      await assert.rejects(
        fetch(url, { headers, signal: AbortSignal.timeout(1000) }),
      );
      assert.equal(host.engine.closed, true);
      return {
        actualLoopbackSocket: true,
        nativeSdkExecution: false,
        closed: true,
      };
    }),
  "cancellation-reaps-real-child-and-grandchild": () =>
    temporary(async (directory) => {
      const marker = join(directory, "tree.json"),
        controller = new AbortController();
      const pending = run(process.execPath, [childFixture, "tree", marker], {
        signal: controller.signal,
        timeout: 20000,
      });
      pending.catch(() => {});
      try {
        const pids = JSON.parse(await waitForFile(marker));
        controller.abort();
        await assert.rejects(pending, /Cancelled subprocess/);
        await assertReaped(Object.values(pids));
        return { realProcesses: 2, reaped: true };
      } finally {
        controller.abort();
        await pending.catch(() => {});
      }
    }),
  "posix-sigterm-cooperatively-disposes": () =>
    temporary(async (directory) => {
      if (process.platform === "win32")
        throw new Unsupported(
          "Windows has no POSIX SIGTERM delivery; forced tree termination is qualified separately",
        );
      const marker = join(directory, "signal"),
        controller = new AbortController();
      const pending = run(process.execPath, [childFixture, "signal", marker], {
        signal: controller.signal,
        timeout: 20000,
      });
      pending.catch(() => {});
      try {
        const pid = Number(await waitForFile(marker));
        process.kill(pid, "SIGTERM");
        await pending;
        assert.equal(await readFile(marker + ".closed", "utf8"), "disposed");
        await assertReaped([pid]);
      } finally {
        controller.abort();
        await pending.catch(() => {});
      }
    }),
  "timeout-and-malformed-executable-fail-closed": () =>
    temporary(async (directory) => {
      await assert.rejects(
        run(process.execPath, [childFixture, "wait"], { timeout: 100 }),
        /Timed out subprocess/,
      );
      await assert.rejects(
        run(join(directory, "no-such-executable"), [], { timeout: 1000 }),
        /ENOENT/,
      );
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        run(process.execPath, [childFixture, "wait"], {
          signal: controller.signal,
        }),
      );
    }),
};
