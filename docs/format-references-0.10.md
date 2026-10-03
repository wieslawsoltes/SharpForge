# Format and API references

Primary specifications used while implementing the format reader and contracts:

- .NET runtime Portable PDB v1.0 format: https://github.com/dotnet/runtime/blob/main/docs/design/specs/PortablePdb-Metadata.md
- .NET runtime PE/COFF addendum: https://github.com/dotnet/runtime/blob/main/docs/design/specs/PE-COFF.md
- Debug Adapter Protocol: https://microsoft.github.io/debug-adapter-protocol/specification
- Windows App SDK Microsoft.UI.Xaml API: https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml
- WebGPU specification: https://www.w3.org/TR/webgpu/

The exact Microsoft PDB fixture blob, licensing and local verification are documented under tests/fixtures/portable-pdb/. API names guide compatibility; this project does not claim Microsoft endorsement or ship proprietary Windows runtime components.
