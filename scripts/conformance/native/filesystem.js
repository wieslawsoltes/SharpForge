import assert from "node:assert/strict";
import {
  access,
  mkdir,
  readFile,
  writeFile,
  symlink,
  realpath,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NativeWorkspace } from "../../../packages/msbuild/src/node.js";
import { writePlan } from "../../../apps/cli/workspace.js";
import { temporary } from "../repro/common.js";

export const filesystemChecks = {
  "case-sensitive-or-insensitive-volume": () =>
    temporary(async (directory) => {
      await writeFile(join(directory, "MixedCase.txt"), "original", {
        flag: "wx",
      });
      let insensitive = true;
      try {
        await access(join(directory, "mixedcase.txt"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        insensitive = false;
      }
      const workspace = await NativeWorkspace.open(directory);
      if (insensitive)
        assert.equal((await workspace.read("mixedcase.txt")).text, "original");
      else
        await assert.rejects(workspace.read("mixedcase.txt"), {
          code: "ENOENT",
        });
      await assert.rejects(
        writePlan(join(directory, "collision"), {
          records: [
            { path: "A.txt", text: "a" },
            { path: "a.txt", text: "b" },
          ],
        }),
        /collid|duplicate/i,
      );
      return {
        volumeCaseInsensitive: insensitive,
        inference: "Only the tested temporary volume",
      };
    }),
  "symlinked-temp-parent-and-native-root": () =>
    temporary(async (directory) => {
      const actual = join(directory, "actual"),
        alias = join(directory, "alias");
      await mkdir(actual);
      await symlink(
        actual,
        alias,
        process.platform === "win32" ? "junction" : "dir",
      );
      await writePlan(join(alias, "created"), {
        records: [{ path: "Program.cs", text: "return 42;" }],
      });
      const workspace = await NativeWorkspace.open(join(alias, "created"));
      assert.equal(workspace.root, await realpath(join(actual, "created")));
      assert.equal((await workspace.read("Program.cs")).text, "return 42;");
      await symlink(
        actual,
        join(workspace.root, "escape"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await assert.rejects(
        workspace.read("escape/anything.cs"),
        /Symbolic links/,
      );
      await assert.rejects(
        writePlan(alias, { records: [{ path: "bad.cs", text: "bad" }] }),
        /symbolic link/i,
      );
      return {
        temporaryRoot: tmpdir(),
        canonicalTemporaryRoot: await realpath(tmpdir()),
        explicitlyConstructedSymlinkParent: true,
        platform: process.platform,
      };
    }),
  "long-path-and-api-length-boundary": () =>
    temporary(async (directory) => {
      const relative =
        Array.from(
          { length: 8 },
          (_, i) => `segment${i}_${"a".repeat(30)}`,
        ).join("/") + "/Long.cs";
      await writePlan(join(directory, "workspace"), {
        records: [{ path: relative, text: "return 7;" }],
      });
      const workspace = await NativeWorkspace.open(
        join(directory, "workspace"),
      );
      assert.equal((await workspace.read(relative)).text, "return 7;");
      await assert.rejects(
        workspace.path("a".repeat(2049)),
        /Invalid workspace path/,
      );
      await assert.rejects(workspace.path("../escape.cs"), /without traversal/);
      return {
        absolutePathCharacters: join(workspace.root, relative).length,
        apiMaximumPathCharacters: 2048,
      };
    }),
  "reserved-windows-names-rejected-before-cli-write": () =>
    temporary(async (directory) => {
      for (const path of [
        "CON.txt",
        "NUL.cs",
        "aux",
        "COM1.txt",
        "LPT9.cs",
        "folder/PRN",
      ]) {
        await assert.rejects(
          writePlan(join(directory, "workspace"), {
            records: [{ path, text: "x" }],
          }),
        );
      }
      await assert.rejects(access(join(directory, "workspace")), {
        code: "ENOENT",
      });
      return {
        portablePolicy: true,
        names: ["CON", "NUL", "AUX", "COM1", "LPT9", "PRN"],
      };
    }),
  "crlf-bom-and-unicode-byte-preservation": () =>
    temporary(async (directory) => {
      const bytes = Buffer.concat([
        Buffer.from([239, 187, 191]),
        Buffer.from("café λ\r\nsecond\r\n"),
      ]);
      await writePlan(join(directory, "cli"), {
        records: [{ path: "Input.txt", bytes: new Uint8Array(bytes) }],
      });
      assert.deepEqual(await readFile(join(directory, "cli/Input.txt")), bytes);
      const workspace = await NativeWorkspace.open(join(directory, "cli"));
      const file = await workspace.read("Input.txt");
      assert.equal(file.text, "café λ\r\nsecond\r\n");
      await workspace.save([
        { path: file.path, text: file.text, expectedHash: file.hash },
      ]);
      assert.deepEqual(await readFile(join(workspace.root, file.path)), bytes);
      await writeFile(
        join(workspace.root, "Invalid.txt"),
        Buffer.from([0xc3, 0x28]),
      );
      await assert.rejects(
        workspace.read("Invalid.txt"),
        /encoded data|encoding|UTF/i,
      );
      return { crlfCount: 2, utf8Bom: true, unchangedBytes: bytes.length };
    }),
  "unicode-normalization-and-portable-collision": () =>
    temporary(async (directory) => {
      const composed = "café.txt",
        decomposed = composed.normalize("NFD");
      await writeFile(join(directory, composed), "unicode");
      let sameIdentity = false;
      try {
        const a = await stat(join(directory, composed)),
          b = await stat(join(directory, decomposed));
        sameIdentity = a.dev === b.dev && a.ino === b.ino;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const workspace = await NativeWorkspace.open(directory);
      assert.equal((await workspace.read(composed)).text, "unicode");
      if (sameIdentity)
        assert.equal((await workspace.read(decomposed)).text, "unicode");
      await assert.rejects(
        writePlan(join(directory, "collision"), {
          records: [
            { path: composed, text: "a" },
            { path: decomposed, text: "b" },
          ],
        }),
        /collid|duplicate/i,
      );
      return {
        volumeTreatsNfcNfdAsSameFile: sameIdentity,
        portableCollisionRejected: true,
      };
    }),
  "native-file-count-text-size-and-stale-save-boundaries": () =>
    temporary(async (directory) => {
      await writeFile(join(directory, "One.txt"), "1234");
      const workspace = await NativeWorkspace.open(directory, {
        maxTextBytes: 4,
        maxFiles: 1,
      });
      assert.equal((await workspace.read("One.txt")).size, 4);
      const previous = await workspace.read("One.txt");
      await writeFile(join(directory, "One.txt"), "4321");
      await assert.rejects(
        workspace.save([
          { path: "One.txt", text: "next", expectedHash: previous.hash },
        ]),
        /Disk conflict/,
      );
      await writeFile(join(directory, "Two.txt"), "12345");
      await assert.rejects(workspace.read("Two.txt"), /size limit/);
      await assert.rejects(workspace.scan(), /file limit/);
      assert.equal(await readFile(join(directory, "One.txt"), "utf8"), "4321");
    }),
};
