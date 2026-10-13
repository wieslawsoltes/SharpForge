# Native WinUI control and accent observations

The locked Windows project captures control/dispatcher behavior and the seven
`UISettings.GetColorValue` accent entries. `AccentPalette.cs` reads every color
from Windows and records the returned ARGB bytes, OS/runtime/assembly identity,
application theme and HighContrast state. It contains no generated palette.
The API contracts are [UISettings.GetColorValue][get-color] and
[UIColorType][color-type].

`winui-run.js` reuses the existing project lock and pinned SDK, executes the real
application twice and rejects any difference between the observations. The
qualification runner validates the full expected-output schema before writing
the capture through the existing store. The helper's source bytes automatically
participate in `winuiInput()` and the existing expected-store input hash. The
qualification report also retains the runner image/toolchain provenance.

Use the existing Windows lane in `.github/workflows/oracles.yml`. Its verify
step writes the newly observed output under `artifacts/results/oracles/` before
comparison, so a missing or stale checked-in baseline fails and still publishes
the actual capture artifact. On the same pinned interactive Windows host,
`node scripts/conformance/oracle/qualify.js --capture --oracle winui --no-benchmark`
captures without updating checked-in expected outputs. Review the actual
capture before promoting a new baseline through the existing update process.

No native accent capture is supplied by this change. The Linux schema fixtures
use explicitly synthetic values only to check shape rejection and hashing.
The browser fallback ramp remains a separate documented approximation. This
capture measures the selected system palette; validating additional accents
requires additional real Windows observations with their environment metadata.

[get-color]: https://learn.microsoft.com/en-us/uwp/api/windows.ui.viewmanagement.uisettings.getcolorvalue
[color-type]: https://learn.microsoft.com/en-us/uwp/api/windows.ui.viewmanagement.uicolortype
