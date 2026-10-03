# Designer and Edit and Continue examples

Each directory has an entry `.slnx`, `.csproj` and complete source. Adjacent ZIPs can be opened directly in Studio with File → Open ZIP. No external package restore is needed by SharpForge's browser compiler. These projects target the SharpForge WinUIWeb profile; a native .NET SDK alone does not implement those contracts.

| Example | Workflow |
|---|---|
| CanvasCounter | Generated design document, per-instance TextBox template, typed input and live counter; attach and edit without restarting. |
| GridWorkspace | Saved Grid design with Auto/pixel/star tracks, NumberBox, InfoBar and shared style. |
| SharedStyles | Shared mutable Setter, local precedence, independent template name scopes and actual managed input/click handlers. |
| ControlGallery | NumberBox, radio groups, date/time values, toggle, InfoBar and closable tab callbacks. |
| EditContinue | Pause the source VM, paste Program.after.cs.txt into Program.cs and apply; method/field additions preserve existing values. |

Use the Designer toolbar to create/capture a document. Its Save command stores `.sfdesign.json`; complete-workspace ZIP preserves it. Generated source is separate from user handlers. Regeneration asks before replacing the browser workspace. Full workflow and limits: `docs/edit-continue-designer.md`.

Regenerate with `npm run examples:designer`.
