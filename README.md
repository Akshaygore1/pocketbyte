# PocketByte

PocketByte is a private, browser-based Java ME game player. It runs local JAR
files through [FreeJ2ME-Web](https://github.com/zb3/freej2me-web), a browser
port of [FreeJ2ME](https://github.com/zb3/freej2me), powered by
[CheerpJ](https://cheerpj.com/). Running in the browser keeps games inside the
web platform sandbox.

## Let's play!
Launch PocketByte from the app's hosted URL or serve the project locally as
described below.


### Keyboard controls
| **Key** | **Functions As** |
| :------------: | :--------------: |
| <kbd>Esc</kbd> | Enter/exit FreeJ2ME options |
| <kbd>F1</kbd> or <kbd>Q</kbd> | Left soft key |
| <kbd>F2</kbd> or <kbd>W</kbd> | Right soft key |
| <kbd>0</kbd> to <kbd>9</kbd> | Keypad Numbers |
| Numpad keys | Numbers with keys 123 and 789 swaped |
| <kbd>E</kbd> | * |
| <kbd>R</kbd> | # |
| <kbd>↑</kbd> | Up |
| <kbd>↓</kbd> | Down |
| <kbd>←</kbd> | Left |
| <kbd>→</kbd> | Right |
| <kbd>⏎ Enter</kbd> | Action key (OK button) |

#### Phone types and key mappings
Keys like left/right soft, arrows and the action key have different vendor-specific mappings. By default, the bundled FreeJ2ME runtime uses the most common **Nokia** mapping, but this can be changed in settings by changing the `Phone type`. Note that in the `Standard` phone, arrow keys are mapped to 2, 4, 6, 8 and the enter key is mapped to 5.

When using the numpad keys, the 123 and 789 rows are swapped so as to resemble the key layout on a mobile phone.

## Game doesn't work?
If a game doesn't work, first try changing the settings. Press the <kbd>Esc</kbd> key, change some settings and then restart the game. Try changing these:
* display size
* compatibility flags
* sound (turn off)

If it still doesn't work you can get more information by looking at the console. Note however that **not every game will work with this emulator**. You can report a bug though.


## What's inside
* FreeJ2ME-Web, the Java ME runtime that powers PocketByte

* Graphics APIs implemented in JS using 2d canvas rendering context (faster than CheerpJ AWT)

* 3D support
    - Implemented using WebGL 2
    - M3G from KEmulator rewritten to use OpenGL ES 2, then optimized
    - Mascot Capsule v3 support from JL-Mod, optimized

* MIDI playback (`libmidi`)
    - modified and debloated fluidsynth compiled to WebAssembly
    - WebAudio API + AudioWorkletNode

* Media playback (`libmedia`)
    - ffmpeg compiled to WebAssembly (to decode formats like amr)
    - rudimentary - the file is fully converted before anything can be played
    - uses a `<video>` tag to play.. "usually" audio :)

## Building

On the host, you need to have docker installed, currently the image assumes a linux host.

After cloning, build the builder image:
```
docker build --build-arg UID=$(id -u) -t freej2me-web-builder builder_image
```

Build the jar like this:
```
docker run --rm -it -uzb3 -w /app -v`pwd`:/app freej2me-web-builder ant
```

In case you want to rebuild `libmidi` / `libmedia` wasm files, build them like this:
```
docker run --rm -it -uzb3 -w /app -v`pwd`:/app freej2me-web-builder web/libmedia/transcode/wasm/build.sh --release
docker run --rm -it -uzb3 -w /app -v`pwd`:/app freej2me-web-builder web/libmidi/wasm/build.sh --release
```

## Serving locally
Thanks to CheerpJ requirements regarding requests with the `Range` header, this is.. not that obvious. In practice, if you just want to serve locally, this one-liner seems to work:
```
npx serve -u web
```

### Cloudflare Pages

Cloudflare Pages serves static asset range requests as complete `200` responses.
PocketByte includes `functions/freej2me-web.jar.js` to provide the `206 Partial
Content` responses CheerpJ requires for the bundled runtime JAR. Deploy the
project through a Pages workflow that includes Functions, then verify the live
response:

```
curl -I -H 'Range: bytes=0-1023' https://your-site.example/freej2me-web.jar
```

The response must be `206` and include `Content-Range` and `Accept-Ranges:
bytes` headers.

## CheerpJ

PocketByte works in the browser thanks to CheerpJ. Since CheerpJ is proprietary,
it introduces some limitations: PocketByte will not work without an internet
connection, and it can be a little slow.

### Product runtime boundary

The React product shell communicates with its dedicated runtime iframe only through
the typed lifecycle protocol in `src/runtime/runtimeAdapter.ts`. The
redistributable MIDlet in `fixtures/runtime-smoke/` runs through FreeJ2ME-Web and
CheerpJ inside `web/runtime-frame.html`, proving the engine boundary without
coupling React components to emulator internals.

The checked and pinned CheerpJ Community loader is
`https://cjrtnc.leaningtech.com/20260317_2978/loader.js` (see `web/run.html`).
CheerpJ Community requires hosted runtime access and attribution. This project is
client-only: user-selected games are not uploaded, but the CheerpJ runtime itself
is fetched from Leaning Technologies' hosted service. Review the
[CheerpJ Community License](https://cheerpj.com/licensing/) before changing the
project's distribution or commercial use.

Guest Java ME networking is offline-only: the checked-in Java ME `Connector`
shim rejects HTTP, HTTPS, socket, and datagram connections before they can
reach browser networking. This does not prevent the host page from fetching the
pinned CheerpJ runtime assets needed to run the emulator. See
[`docs/security/guest-network-denial.md`](docs/security/guest-network-denial.md)
for the boundary and verification plan.

The bundled FreeJ2ME-Web runtime intentionally does not use CheerpJ's more
advanced features, such as AWT GUI support or wasm JNI modules. In theory it
could be ported to a simpler (but likely slower) VM if CheerpJ stops being
available, but that is not planned.

## Embedding
To embed a specific game on your website, first self-host PocketByte. The `web`
directory should be served, but ensure your server properly supports the
`Range` header.

When you want to embed a game, a JAR file (even with a JAD descriptor) is often
not enough: PocketByte needs to know the screen size, phone type, and potentially
other configuration settings. You might even need to preload RMS data.

Therefore, you must first prepare a `.zip` file for each game as follows:

1.  Install the game within the launcher screen.
2.  Tweak PocketByte settings as needed.
3.  Configure the game if necessary.
4.  Click "Export Data".
5.  Identify the App ID: Launch the application and observe the `app` parameter in the URL.
6.  Locate the App ID folder**: Find the folder named after the App ID within the exported `.zip` file.
7.  **Create the game's `.zip` file**: Compress all contents of that App ID folder into a new `.zip` file named after the App ID (`[app_id].zip`).
8.  **Place the `.zip` file**: Put this newly created `.zip` file into the `apps` folder of your hosted PocketByte instance (`run.html` and the `apps` folder should be in the same directory)

Once prepared, you can embed the game directly using `run.html?app=[app_id]` without requiring the user to visit the launcher page first.

Note that your iframe dimensions should match the game's screen size or a multiple thereof. To match only the aspect ratio, pass the `fractionScale` parameter to `run.html`, for example: `run.html?app=[app_id]&fractionScale=1`.
