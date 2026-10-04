# A16 media fixture

`transport.mp4` is a two-second synthetic video generated for SharpForge from
FFmpeg's `testsrc2` generator. It contains no external recording, fonts, personal
data, or third-party audiovisual content. It is covered by the repository license.

It uses H.264 Constrained Baseline, yuv420p, 96×64, 10 frames per second, and an MP4
container with metadata at the start so browser transport tests do not require a
remote media service. Decoder availability is recorded per browser/platform.

Recreate the asset with:

```sh
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=96x64:rate=10 \
  -t 2 -an -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.0 \
  -movflags +faststart -metadata title='SharpForge A16 synthetic media fixture' transport.mp4
```

Asset creation is separate from playback qualification; the browser fixture must
observe playback, pause and seek after the complete scope is implemented.
