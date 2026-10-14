# KESTREL-VIDEO

The video engine of Kestrel: every video, thumbnail, description, like and comment lives here, and any Kestrel app can use them. The **Kestrel Tube**
app (`app install tube`, then `app run tube`) is just one window onto this repository; an app of your own can read `catalog.txt` and play
`videos/<id>.kmv` with `video_open` the same way (base address `https://raw.githubusercontent.com/really-gavin/KESTREL-VIDEO/main/`).

```
catalog.txt         the list of all videos, one line per video, newest first:  id|seconds|date|channel|title
videos/<id>.kmv     the movie (a .kesmovie file)
thumbs/<id>.kmv     its picture (a one-frame .kesmovie)
meta/<id>.txt       its description
comments/<id>.txt   comments   (written by the Kestrel gateway, not by hand)
likes/<id>.txt      likes      (written by the Kestrel gateway; keyed hashes, no addresses)
```

The catalog starts empty: Tube shows "Nothing to watch yet" until the first video is added.

## Adding a video (on a PC with ffmpeg and the `kmv` tool from the Kestrel source, `tools/kmv`)

```
git clone https://github.com/really-gavin/KESTREL-VIDEO
kmv publish -dir KESTREL-VIDEO -id my-first-video -title "My first video" -channel "Gavin" -desc "What it is about" holiday.mp4
cd KESTREL-VIDEO && git add -A && git commit -m "Add my-first-video" && git push
```

`kmv publish` makes the movie (360p, 30 fps at most, sound 48 kHz) and its thumbnail and puts the video at the top of `catalog.txt`.
Use `-h 480` or `-h 720` for a bigger picture and `-q 80` for a better one (the file gets bigger: GitHub refuses files over 100 MB).
`kmv unpublish -dir KESTREL-VIDEO my-first-video` takes a video out again. The format is described in `docs/KESMOVIE.md` of the Kestrel source.

## Comments and likes

The app sends them to the Kestrel gateway (the Cloudflare Worker, `kestrel-web/gateway/worker.js`), which writes them into this repository. For that, the
Worker needs the variable `VIDEO_REPO = really-gavin/KESTREL-VIDEO`, and its `GITHUB_TOKEN` must also be allowed to write to this repository
("Contents: read and write"). Optionally add a variable `VIDEO_SALT` (any long random text) to key the like hashes.
