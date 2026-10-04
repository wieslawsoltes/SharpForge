# Shared workspace text admission

NativeWorkspace read/save admission uses the public archive
`isWorkspaceTextPath(path)` policy, plus the existing custom project-file suffix
rule. Native and portable workspace consumers therefore agree on XAML,
application/package manifests, publish profiles and other editable text paths.
A native `.vcxproj` retains normal XML validation and save behavior.

Admission does not change file contents into text by extension alone. The native
codec still rejects binary content and preserves decoded UTF-16 little/big endian,
BOM presence and newline style. Saving unchanged text keeps the original raw
bytes; edits retain the original encoding. Path containment, reserved/symlink
checks, text/request budgets and expected-hash conflict protection remain active.

The authenticated HTTP regression exercises XAML and manifest files in both
UTF-16 endiannesses with and without BOMs, verifies byte-identical unchanged
saves and correctly encoded edits, and rejects binary read/save attempts without
modifying their bytes. It also creates and reopens a custom project file.
