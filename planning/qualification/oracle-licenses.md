# Reference-oracle tool licensing policy

Task: SF-A29-T02.7 (#1127). Reviewed against SDK 10.0.201, the pinned oracle
manifest and WinUI NuGet lock on 2026-10-04. The
[machine-readable catalog](oracle-licenses.json) records seven tool entries,
all fourteen distinct locked NuGet dependencies, four workflow actions and
three platform images. It also covers the implicit Windows SDK .NET reference
package and both native workflows' different Node versions.

This is SharpForge's policy for acquiring and distributing oracle tooling.
The upstream terms remain authoritative. A source repository's MIT license
does not replace the terms of Microsoft's shipped SDK packages or an operating
system image. A successful oracle run does not establish redistribution rights.

## Acquisition, caching and distribution

| Material | Cache/use for this harness | Redistribution boundary |
| --- | --- | --- |
| .NET SDK 10.0.201, bundled Roslyn, CoreCLR and .NET reference pack 10.0.5 | Official SDK download or exact container digest; private build/tool caches retain complete notices | Preserve the distribution's `LICENSE.txt` and `ThirdPartyNotices.txt`, including bundled MSBuild/NuGet/runtime terms. Do not commit SDK/compiler/runtime/reference binaries. |
| Windows App SDK and its locked dependencies | NuGet locked restore for Windows development/testing; private package cache | Apply each exact package's terms below. AppSDK source MIT is not the binary package license. No package is approved for standalone SDK redistribution by this policy. |
| Windows SDK build tools and .NET reference package | Download/restore for compilation on authorized development/build hosts | SDK use rights differ from the conditional rights for REDIST-listed code. The reference pack and arbitrary build tools are not an application redistribution payload. |
| Node 22.23.3 / 24.21.0 and pinned GitHub actions | Provider/downloaded tooling; cache only with complete notices | Their source license and bundled dependency notices apply. They are not copied into the oracle corpus. |
| Linux SDK container | Local/provider layer cache of the exact digest | .NET and Ubuntu/component terms apply separately. A Dockerfile source license does not license every image layer. No image export is part of this harness. |
| Windows/macOS hosted image | Provider-managed VM for the Actions job | Record exact ImageOS/ImageVersion. Do not copy/cache/export the VM or infer OS/software rights from the runner-images source license. |

The .NET [SDK source license](https://github.com/dotnet/sdk/blob/v10.0.201/LICENSE.TXT),
[runtime license](https://github.com/dotnet/runtime/blob/v10.0.5/LICENSE.TXT) and
[runtime third-party notices](https://github.com/dotnet/runtime/blob/v10.0.5/THIRD-PARTY-NOTICES.TXT)
identify distinct source and dependency obligations. The exact SDK archive URLs
and integrity pins remain in [oracle-toolchain.json](oracle-toolchain.json).
Roslyn's observed compiler build commit is not publicly resolvable as a license
URL; the catalog explicitly separates an immutable public source-license
observation from the pinned SDK binary distribution and its bundled notices.

## Exact NuGet package review

The catalog binds each locked package's name, version and content hash to its
license declaration. For `license type="file"`, it records the path within the
exact NuGet package and the SHA-256 of the observed license file. Those files
were read from the existing pinned package restore; no new native build or
package execution was performed for this review. License text is not assumed
identical just because package IDs share a prefix.

| Package(s), exact versions | Terms and decision |
| --- | --- |
| Microsoft.WindowsAppSDK 1.8.260921001; AI 1.8.79; Base 1.8.251216001; Foundation 1.8.260803002; InteractiveExperiences 1.8.260708001; Runtime 1.8.260921001; WinUI 1.8.260803003 | Their identical packaged license files use [Microsoft Windows App SDK binary terms](https://www.nuget.org/packages/Microsoft.WindowsAppSDK/1.8.260921001/License). Section 3 covers files placed with an application by the package, subject to distribution requirements; this is not permission to publish a standalone SDK. |
| Microsoft.WindowsAppSDK.DWrite 1.8.25122902; Widgets 1.8.251231004 | These packaged license files omit the umbrella package's explicit binplaced-files clause. Do not infer that clause for their separate redistribution. Restore them for the Windows host; the catalog retains their own file hashes. |
| Microsoft.WindowsAppSDK.ML 1.8.2223 | Its own AppSDK/Windows ML terms additionally address third-party materials and execution-provider licenses. The oracle does not download models/providers or exercise ML; the transitive package still requires an entry. |
| Microsoft.Windows.SDK.BuildTools 10.0.26100.4654; Microsoft.Windows.SDK.NET.Ref 10.0.19041.57 | Both package manifests declare `https://aka.ms/WinSDKLicenseURL`, resolved in this review to Microsoft's [Windows SDK terms](https://download.microsoft.com/download/0/F/F/0FF2B061-47DD-4F55-89B6-FD1D8C44F14D/sdk_license.rtf). The catalog records that exact document's hash. |
| Microsoft.Windows.SDK.BuildTools.MSIX 1.7.20250829.1 | The package carries its own `sdk_license.txt` Windows SDK terms. Keep its distinct bytes/hash; REDIST/utility permissions are conditional, not a grant for arbitrary tools. |
| Microsoft.Web.WebView2 1.0.3179.45 | The [SDK package license](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3179.45/License) permits source/binary redistribution with notice and non-endorsement conditions. That does not grant rights for a separate WebView2 browser runtime. |
| System.Numerics.Tensors 9.0.0 | The package declares [MIT](https://licenses.nuget.org/MIT). Preserve the notice if redistributed; no tensor binary is vendored by this harness. |

`Microsoft.Windows.SDK.NET.Ref` is pinned by `WindowsSdkPackageVersion` in the
WinUI project rather than its NuGet dependency lock. The two target sections of
the lock repeat some packages; they do not create separate licensing identities.
Transitive packages are cataloged even when the fixtures do not exercise their APIs.

## Images, workflow tools and provenance

The catalog preserves the exact Linux digest and Windows/macOS image pins from
the toolchain manifest. Microsoft's [.NET image licensing references](https://github.com/dotnet/dotnet-docker/blob/main/README.sdk.md#license)
and Canonical's [component/distribution policy](https://canonical.com/legal/intellectual-property-policy)
apply to the Linux image. GitHub's [Actions terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions)
govern hosted VM access, including GitHub's role for bundled Apple software.
These service documents describe access conditions; they are not reproducible
image contents or a native qualification result. Record image drift as a failure.

Node's full versioned `LICENSE` includes bundled component terms. Each workflow
action license link is bound to the exact `uses` SHA, not a moving major-version
tag. Downloaded tool caches retain their notices. License catalog changes must
accompany SDK, package, action, Node or image pin changes.

## Repository boundary and guard

Only authored sources, catalogs, license/provenance metadata and reviewed text
observations belong in the reference-oracle paths. Restored package payloads,
SDK installers, native SDK/compiler binaries and VM/container archives stay
outside Git. Generated oracle host binaries are build artifacts, not new
third-party source files; publishing a binary bundle requires applying its
component distribution terms separately.

The companion `scripts/conformance/oracle/license-policy.js` guard checks catalog
coverage against the actual pins and applies the catalog's path filter. It
rejects tool/package payload names anywhere and binary/archive payloads within
the oracle source/corpus/expected roots. It does not ban every DLL in the
repository: authored managed/PDB fixtures elsewhere retain their existing
provenance rules. A generated binary fixture inside a protected root needs an
exact path/hash/source exception; upstream tool payload names cannot use that
exception. No exceptions are currently declared.

This is a bounded path guard, not binary decompilation, archive unpacking or a
claim that arbitrary renamed bytes have been license-classified. It runs without
network or native tools and belongs in the existing shared core job. It does
not add native work to ordinary pull requests. Focused guard regressions and
CI integration qualification remain separate from this authored policy review.
