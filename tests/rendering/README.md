# Portable rendering fixtures

The staged corpus covers paths, shapes, stroke/dash, gradients, images, clipping, alpha, all supported effects,
composition brushes and trim, DPR, ten thousand instances and pinned numeric glyphs. Numeric fixtures await actual
shaping and color decode and expose a declared independent Canvas raster reference. Geometry uses the reviewed
path corpus. Each fixture disposes its explicit resources after capture.

These fixtures depend on complete render surfaces and the numeric provider. Control chrome and public-facade
template galleries are restored by the later host/gallery stage; this subset imports no unavailable host facade.
Native WinUI references remain pending and backend images have not been fabricated.
