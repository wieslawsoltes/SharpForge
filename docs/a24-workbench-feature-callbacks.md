# Lazy native and designer workbench callbacks

Designer activation receives the existing markup edit/validation services together
with C# source callbacks and captured diagnostic ownership. Lazy activation does
not construct another source synchronization service or change document ownership.

Native activation forwards selected project context and test preparation/navigation
callbacks while preserving captured job-failure ownership. Generated source retains
its original metadata and version and is admitted through DocumentService as
read-only. The native facade reads context/profile/test state passively; run and
publish only invoke the feature on an explicit operation.

The four focused cases cover both source formats, callback identity/cancellation,
generated metadata and passive facade reads. Product and fixture bytes match
canonical source `7b087e0f0e3105c71ec86e39554358766b45d3bf`. The actual Studio entry
and platform-specific native execution are separate qualification boundaries.
