import { BUILD_ACTIONS } from './contract.js';

export const MSBUILD_HELP=`SharpForge local MSBuild bridge (requires Node 22+ and an installed SDK/MSBuild)

  sharpforge-msbuild serve --root <workspace> --studio <dist> --trust-projects
  sharpforge-msbuild build <relative.csproj|slnx> --root <workspace> --trust-projects --restore
  sharpforge-msbuild evaluate <relative.csproj> --root <workspace> --trust-projects --json
  sharpforge-msbuild target <relative.csproj> --target MyTarget --trust-projects

Actions: ${BUILD_ACTIONS.join(', ')}
Options:
  --root DIR                 Explicit workspace root (default current directory)
  --studio DIR               Static SharpForge dist directory (serve only)
  --connect-origin ORIGIN    Repeatable outgoing browser CSP grant (serve only; VM grant is separate)
  --port NUMBER              Loopback port (default 4175; 0 chooses an available port)
  --engine dotnet|msbuild    dotnet msbuild, or a standalone MSBuild executable
  --executable PATH          Owner-selected native executable (default dotnet/MSBuild.exe)
  --trust-projects           Permit local code execution, including evaluation and restore
  --trust-store PATH        Host-owned persistent workspace trust store
  --elevated-native         Permit advanced logger/toolset switches
  --node-reuse              Enable native MSBuild node reuse with shutdown on close
  --compiler-server         Enable shared compiler server with shutdown on close
  --sarif                   Capture structured SARIF compiler diagnostics
  --configuration VALUE     Global Configuration property
  --platform VALUE          Global Platform property
  --framework TFM           Select one target framework; omitted builds all configured TFMs
  --runtime RID             Global RuntimeIdentifier property
  --property Name=Value     Repeatable global properties
  --target Name             Repeatable custom targets (target action)
  --result-target Name      Repeatable target-result queries (executes targets)
  --restore                 Restore before execution
  --binlog                  Capture binary log (may contain sensitive build data)
  --graph                   Enable graph build
  --max-nodes N             Parallel MSBuild nodes (1–64)
  --verbosity LEVEL         quiet|minimal|normal|detailed|diagnostic
  --json                    Print the final job result instead of streaming output
  -- <MSBuild switches>     Advanced individual switches, no shell invocation

Projects/tasks/property functions execute with your OS account. This is NOT a sandbox.
The host binds only 127.0.0.1, serves the IDE on the same origin, and uses an ephemeral token.
SDKs, workloads, packages and Windows-only tasks must be installed/available locally.
`;
