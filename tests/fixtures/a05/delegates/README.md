# Managed delegate protocol

This C# fixture is compiled by the installed Roslyn SDK for the native A05 plan.
The same emitted DLL runs in .NET and `CilVirtualMachine`; it exercises real CLI
`ldvirtftn`, delegate construction and invocation, plus managed multicast APIs.
It is distinct from source-bytecode compiler tests that generate a numbered
delegate dispatcher.

`expected.txt` is an authored contract trace, not a captured native result.
Qualification records the actual source and DLL hashes, SDK/runtime versions,
commands and outcomes. Run it explicitly with:

```sh
node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05/delegates --output artifacts/a05-delegates
```

`tests/a05-managed-delegate-protocol.test.js` separately assembles its metadata and
instructions without Roslyn or the source compiler. The virtual target collects
inside the override, proving that the retained bound receiver remains a root.
