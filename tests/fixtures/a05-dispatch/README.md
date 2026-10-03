# Virtual dispatch reference fixture

`Program.cs` is the Roslyn/native counterpart of `tests/a05-b03-dispatch.test.js`.
Its expected output is `1\n3\n3\n7\n`. Compile the unmodified source with the
installed .NET SDK, execute that DLL with both .NET and `CilVirtualMachine`, and
compare the outputs during the complete A05 defect-scope validation.

The JavaScript fixtures additionally cover explicit class `MethodImpl` rows,
MemberRef call sites, malformed implementations, nonvirtual hiding, and final
slots. These are independent CIL metadata fixtures, not native qualification.

Contract: ECMA-335 sixth edition, II.10.3 (newslot and overrides), II.22.27
(MethodImpl), and III.4.2 (callvirt), available in the
[official specification](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
