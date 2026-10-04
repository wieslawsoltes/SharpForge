# NuGet V3 resources

The browser-safe entry exports `NuGetV3Client(indexUrl, options)`. It discovers
service resources from a V3 index and exposes `search`, `versions`, `nuspec`,
`registration` and `vulnerabilities`. Search supports bounded `skip`/`take` and
prerelease selection. Registration combines inline and fetched pages; advisory
pages are combined by package ID. Package versions use the shared NuGet version
normalization contract.

`fetchResource(url, {signal, format, cache})` is the common resource operation.
Formats are JSON by default, `text`, or `bytes`. Every operation accepts an abort
signal. Responses are streamed within a byte budget, redirects are rejected, and
browser credentials are omitted. A resource on another origin requires that
origin in `allowedOrigins`; feed URL user/password components are rejected.
Authenticated calls require `hostSide: true` and a host-owned
`credentials(url)` function returning request headers. Credentials are never
stored in the resource cache or returned as model data.

The cache returns structured clones so a consumer cannot mutate future results.
`clear()` empties both resource data and the remembered service index. Defaults
are 16 MiB per resource and 64 cached entries. Configurable limits are validated
before fetching; the maximum is 256 MiB per resource and 1,024 entries.

Resource-specific bounds limit the service index to 1,024 resources, search pages
to 1,000 results, version listings to 100,000 versions, registration to 1,024
pages/100,000 entries, and the vulnerability index to 64 pages. The same resource
byte bound applies to every fetched page. Unsupported or missing service types
and invalid response shapes fail explicitly.

The recorded protocol test injects `fetch` and performs no network access. Native
configuration selection, host credentials and authenticated HTTP contributions
are composed in the separate native NuGet service batch. Successful recorded
responses do not imply reachability or qualification of an external feed.
