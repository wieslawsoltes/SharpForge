# Rendering comparison evidence

The comparison helpers consume real premultiplied RGBA8 captures. They bound image dimensions, compressed and decoded
bytes, PNG encodings, pixel tolerances and artifact identifiers before comparison. PNG output uses straight alpha.

Backend golden updates require an explicit update flag. Ordinary comparisons are read-only and fail if a backend
reference is absent. Their metadata must match the backend, adapter tier and capture mode. A backend baseline does
not establish native WinUI parity.

Native references are read only from an explicit provider directory. Each capture must identify native WinUI,
the pinned Windows App SDK version, tool version, capture command, operating system, dimensions and alpha convention.
Missing native captures remain `pending-native`; a backend update can never create native provenance.

Independent Canvas references declare their actual provider and glyph-access contract. Missing required references,
invalid profiles, wrong dimensions, malformed buffers and failed differences cannot qualify a fixture.

## Validation

The Python unit fixtures use bounded in-memory pixels and temporary reference directories. Their presence does not
claim real renderer, GPU, native WinUI or exact-draft execution. Run their group only after the complete scope opens:

```sh
python -m unittest discover -s tests/rendering -p 'test_*.py'
```
