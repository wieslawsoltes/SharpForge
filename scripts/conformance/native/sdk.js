import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  NativeWorkspace,
  NativeMSBuild,
} from "../../../packages/msbuild/src/node.js";
import { compileToIL } from "../../../packages/compiler/src/index.js";
import { createRuntimeConfig } from "../../../packages/cil/src/index.js";
import { clrExecutionCases } from "../../../tests/clr-fixtures.js";
import { cilExecutionCases } from "../../../tests/cil-fixtures.js";
import { runProcess } from "../oracle/process.js";
import { nativeExitStatus } from "../native-exit-status.js";
import { temporary, abortIfNeeded } from "../repro/common.js";
import { root, observe, quantiles } from "./contracts.js";
import { waitForFile, assertReaped } from "./process.js";

const xml = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
export async function sdkWorkspace(directory, pin) {
  await writeFile(
    join(directory, "global.json"),
    JSON.stringify({
      sdk: {
        version: pin.version,
        rollForward: "disable",
        allowPrerelease: false,
      },
    }),
  );
  await writeFile(
    join(directory, "NuGet.Config"),
    "<configuration><packageSources><clear /></packageSources></configuration>",
  );
  await mkdir(join(directory, "Probe"));
  await copyFile(
    join(root, "tests/conformance/native/fixtures/NativeProbe.cs"),
    join(directory, "Probe/Program.cs"),
  );
  await writeFile(
    join(directory, "Probe/Probe.csproj"),
    `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>${pin.framework}</TargetFramework><OutputType>Exe</OutputType>
  <RuntimeFrameworkVersion>${pin.runtime}</RuntimeFrameworkVersion><RollForward>Disable</RollForward>
  <UseAppHost>false</UseAppHost><RestoreIgnoreFailedSources>false</RestoreIgnoreFailedSources>
  <Deterministic>true</Deterministic><NuGetAudit>false</NuGetAudit></PropertyGroup></Project>`,
  );
  return NativeWorkspace.open(directory);
}
async function command(context, executable, args, options = {}) {
  abortIfNeeded(context.signal);
  const result = await runProcess(executable, args, {
    cwd: context.directory,
    signal: context.signal,
    timeoutMs: 120000,
    ...options,
  });
  context.commands.push({
    argv: [executable, ...args],
    cwd: context.directory,
    ...result,
  });
  return result;
}
async function job(context, request, expected = "succeeded") {
  abortIfNeeded(context.signal);
  const started = await context.engine.start({
    project: "Probe/Probe.csproj",
    action: "build",
    trusted: true,
    ...request,
  });
  const result = await context.engine.wait(started.id);
  context.commands.push({
    argv: [result.invocation.executable, ...result.invocation.arguments],
    exitCode: result.exitCode,
    status: result.status,
    signal: result.signal,
    diagnostics: result.diagnostics,
    events: result.events,
  });
  assert.equal(
    result.status,
    expected,
    result.error ?? result.events.map((event) => event.text).join(""),
  );
  return result;
}
async function nativeIL(context, pin) {
  const checks = [];
  const cases = [
    ...clrExecutionCases.map(([name, source, code]) => ({
      name,
      source,
      code,
      output: "",
    })),
    ...cilExecutionCases.map(([name, source, output]) => ({
      name: "console-" + name,
      source,
      code: 0,
      output,
    })),
  ];
  for (const [index, fixture] of cases.entries()) {
    checks.push(
      await observe("cil/" + fixture.name, async () => {
        abortIfNeeded(context.signal);
        const name = "NativeIL" + index,
          compilation = compileToIL(fixture.source, { name });
        assert(compilation.success, JSON.stringify(compilation.diagnostics));
        await writeFile(
          join(context.directory, name + ".dll"),
          compilation.assembly,
        );
        await writeFile(
          join(context.directory, name + ".runtimeconfig.json"),
          JSON.stringify(
            createRuntimeConfig({
              version: pin.runtime,
              rollForward: "Disable",
            }),
          ),
        );
        const result = await command(context, context.dotnet, [
          join(context.directory, name + ".dll"),
        ]);
        assert.equal(
          result.exitCode,
          nativeExitStatus(fixture.code),
          result.stderr,
        );
        assert.equal(result.signal, null);
        assert.equal(result.stdout.replaceAll("\r\n", "\n"), fixture.output);
        return {
          managedExit: fixture.code,
          observedExit: result.exitCode,
          runtime: pin.runtime,
        };
      }),
    );
  }
  checks.push(
    await observe("cil/malformed-native-image", async () => {
      await writeFile(
        join(context.directory, "Malformed.dll"),
        Buffer.from("not a managed PE image"),
      );
      await writeFile(
        join(context.directory, "Malformed.runtimeconfig.json"),
        JSON.stringify(
          createRuntimeConfig({ version: pin.runtime, rollForward: "Disable" }),
        ),
      );
      const result = await command(context, context.dotnet, [
        join(context.directory, "Malformed.dll"),
      ]);
      assert.notEqual(result.exitCode, 0);
      assert(result.stderr.length > 0);
      return { observedExit: result.exitCode, signal: result.signal };
    }),
  );
  return checks;
}
async function nativeMSBuild(context, pin, probeAssembly) {
  const checks = [],
    check = async (id, callback) => checks.push(await observe(id, callback));
  await check("msbuild/sdk-project-real-runtime-and-architecture", async () => {
    const result = await command(context, context.dotnet, [
      probeAssembly,
      "info",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    const info = JSON.parse(result.stdout);
    assert.equal(info.runtime, pin.runtime);
    assert.equal(info.architecture, process.arch);
    assert.equal(info.value, 42);
    assert.equal(info.unicode, "café λ");
    return info;
  });
  await check("msbuild/evaluate-preprocess-targets-and-artifacts", async () => {
    const evaluated = await job(context, { action: "evaluate" });
    assert.equal(evaluated.result.Properties.TargetFramework, pin.framework);
    assert.match(evaluated.result.Properties.MSBuildVersion, /^\d+\./);
    const expanded = await job(context, { action: "preprocess" });
    assert.match(expanded.result.preprocessedText, /Microsoft.NET.Sdk/);
    const targets = await job(context, { action: "targets" });
    assert.match(targets.result.targetsText, /Build/);
    const artifact = expanded.artifacts.find(
      (item) => item.kind === "preprocessed",
    );
    assert(artifact);
    assert(
      (await context.engine.artifact(expanded.id, artifact.path)).length > 0,
    );
    await assert.rejects(
      context.engine.artifact(expanded.id, "Probe/Program.cs"),
      /not listed/,
    );
  });
  const project = "Pipeline.proj",
    copied = join(context.directory, "Copied.txt");
  const marker = join(context.directory, "native-tree.json");
  await writeFile(join(context.directory, "Input.txt"), "preserved\r\n");
  const execute = (mode) =>
    xml(`"${context.dotnet}" "${probeAssembly}" ${mode}`);
  await writeFile(
    join(context.directory, project),
    `<Project DefaultTargets="Build">
  <Target Name="Build" Inputs="Input.txt" Outputs="Copied.txt"><Copy SourceFiles="Input.txt" DestinationFiles="Copied.txt" /></Target>
  <Target Name="Diagnose"><Error Code="SFNATIVE001" Text="intentional negative fixture" /></Target>
  <Target Name="Wait"><Exec Command="${execute('tree "' + marker + '"')}" /></Target>
  <Target Name="Noise"><Exec Command="${execute("noise")}" /></Target>
  <Target Name="Noop"><Message Text="Native target 42" Importance="high" /></Target>
  </Project>`,
  );
  await check("msbuild/incremental-copy-and-negative-target", async () => {
    await job(context, { project });
    const before = await stat(copied);
    await job(context, { project });
    assert.equal((await stat(copied)).mtimeMs, before.mtimeMs);
    assert.equal(await readFile(copied, "utf8"), "preserved\r\n");
    const negative = await job(
      context,
      { project, action: "target", targets: ["Diagnose"] },
      "failed",
    );
    assert(negative.diagnostics.some((item) => item.code === "SFNATIVE001"));
  });
  await check("msbuild/malformed-path-request-and-sdk-project", async () => {
    await assert.rejects(
      context.engine.start({ project: "../escape.csproj", trusted: true }),
    );
    await assert.rejects(
      context.engine.start({ project, trusted: true, maxNodes: 65 }),
      /1–64/,
    );
    await assert.rejects(
      context.engine.start({
        project,
        trusted: true,
        arguments: ["@missing.rsp"],
      }),
    );
    await writeFile(
      join(context.directory, "Broken.csproj"),
      "<Project><Broken>",
    );
    const failed = await job(context, { project: "Broken.csproj" }, "failed");
    assert(failed.diagnostics.some((item) => item.code.startsWith("MSB")));
  });
  await check(
    "msbuild/cancel-reaps-native-grandchildren-and-disposes",
    async () => {
      const started = await context.engine.start({
        project,
        action: "target",
        targets: ["Wait"],
        trusted: true,
      });
      try {
        const pids = JSON.parse(await waitForFile(marker, { timeout: 30000 }));
        context.engine.cancel(started.id);
        const result = await context.engine.wait(started.id);
        assert.equal(result.status, "cancelled");
        assert.equal(result.cancelReason, "user");
        await assertReaped(Object.values(pids));
        return {
          actualSdkProcesses: true,
          reaped: true,
          result: result.status,
        };
      } finally {
        if (context.engine.active) {
          context.engine.cancel(started.id);
          await context.engine.wait(started.id);
        }
      }
    },
  );
  await check("msbuild/output-boundary-cancels-real-sdk", async () => {
    const bounded = new NativeMSBuild(context.workspace, {
      executable: context.dotnet,
      trusted: true,
      maxOutputBytes: 1024,
    });
    try {
      const started = await bounded.start({
        project,
        action: "target",
        targets: ["Noise"],
        trusted: true,
      });
      const result = await bounded.wait(started.id);
      assert.equal(result.status, "cancelled");
      assert.equal(result.cancelReason, "output-limit");
      assert.match(result.error, /output limit/);
    } finally {
      await bounded.close();
    }
  });
  return checks;
}
async function measurements(context, probeAssembly) {
  const samples = [],
    allocationSamples = [],
    msbuildSamples = [];
  for (let i = 0; i < 21; i++) {
    const result = await command(context, context.dotnet, [
      probeAssembly,
      "allocate",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    const observed = JSON.parse(result.stdout);
    const checksum = Array.from(
      { length: 1000 },
      (_, index) => index % 251,
    ).reduce((a, b) => a + b, 0);
    assert.equal(observed.checksum, checksum);
    assert(observed.allocatedBytes >= 128000);
    samples.push(result.elapsedMs);
    allocationSamples.push(observed.allocatedBytes);
    const start = performance.now();
    await job(context, {
      project: "Pipeline.proj",
      action: "target",
      targets: ["Noop"],
    });
    msbuildSamples.push(performance.now() - start);
  }
  return {
    coreclr: {
      coldMs: samples[0],
      warmMs: samples.slice(1),
      ...quantiles(samples.slice(1)),
      allocations: {
        metric: "GC.GetAllocatedBytesForCurrentThread",
        bytes: allocationSamples,
      },
      warmMeaning: "Repeated fresh native processes, including process startup",
    },
    msbuild: {
      coldMs: msbuildSamples[0],
      warmMs: msbuildSamples.slice(1),
      ...quantiles(msbuildSamples.slice(1)),
      allocations: {
        status: "unknown",
        reason: "No native MSBuild allocation profiler was attached",
      },
      warmMeaning: "Repeated fresh MSBuild processes; node reuse disabled",
    },
  };
}
export async function qualifySdk(
  pin,
  {
    signal,
    measure = false,
    dotnet = process.env.DOTNET_PATH || "dotnet",
  } = {},
) {
  return temporary(async (directory) => {
    const workspace = await sdkWorkspace(directory, pin);
    const engine = new NativeMSBuild(workspace, {
      executable: dotnet,
      trusted: true,
      timeoutMs: 120000,
    });
    const context = {
      directory,
      workspace,
      engine,
      signal,
      dotnet,
      commands: [],
    };
    const cancel = () => {
      if (engine.active)
        engine.cancel(engine.active, "qualification-cancelled");
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const version = await command(context, dotnet, ["--version"]);
      assert.equal(version.exitCode, 0, version.stderr);
      assert.equal(
        version.stdout.trim(),
        pin.version,
        "global.json must select the exact SDK",
      );
      const built = await job(context, {
        restore: true,
        configuration: "Release",
        binaryLog: true,
      });
      const probeAssembly = join(
        directory,
        "Probe/bin/Release",
        pin.framework,
        "Probe.dll",
      );
      assert(built.artifacts.some((item) => item.path.endsWith("/Probe.dll")));
      // SDK host, selected runtime and process architecture are prerequisites for
      // both engines. An emulated/wrong host cannot qualify the IL row separately.
      const identity = await command(context, dotnet, [probeAssembly, "info"]);
      assert.equal(identity.exitCode, 0, identity.stderr);
      const native = JSON.parse(identity.stdout);
      assert.equal(native.runtime, pin.runtime);
      assert.equal(native.architecture, process.arch);
      const msbuild = await nativeMSBuild(context, pin, probeAssembly);
      const il = await nativeIL(context, pin);
      const benchmark = measure
        ? await observe("measurements/correctness-gated", () =>
            measurements(context, probeAssembly),
          )
        : {
            id: "measurements",
            status: "unknown",
            reason:
              "Native benchmark capture deferred; invoke --measure in the integrated batch",
          };
      return {
        checks: { "native-il": il, "native-msbuild": msbuild },
        benchmark,
        commands: context.commands,
      };
    } catch (error) {
      error.commands = context.commands;
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
      await engine.close();
    }
  });
}
