# Select resolution and restart safely

Status: resolved

## Parent

[Browser-based Java ME game emulator v1](../PRD.md)

## What to build

Allow the player to choose any supported logical resolution and apply it through a warned emulator restart. The logical canvas must remain independent from its CSS display size, retain its aspect ratio, and stay crisp when enlarged.

## Acceptance criteria

- [x] The selector offers exactly 128×160, 176×208, 240×320, 320×240, 360×640, and 480×800.
- [x] A resolution change warns about volatile unsaved progress before tearing down and recreating the emulator instance.
- [x] The selected resolution is remembered for the JAR and is restored on the next launch.
- [x] Every preset produces the requested logical canvas dimensions without stretching, and enlargement uses pixel-sharp scaling.
- [ ] Browser tests verify the restart lifecycle, stale-frame protection, retained persistent game data, aspect ratio, and all six presets.

## Blocked by

- [04 — Choose and launch a MIDlet](04-choose-and-launch-midlet.md)

## Comments

The player now exposes the six agreed logical resolutions, defaults new games
to 480×800, and remembers the selected preset under the validated JAR's SHA-256
identity. Changing the resolution of a running game warns that volatile
progress may be lost, releases held keys, and asks the runtime adapter to
restart with the new dimensions.

Restart replaces the isolated runtime iframe and assigns a new session before
relaunching the same per-JAR app identity. Messages from the removed frame are
therefore ignored while the emulator's persistent app data remains in place.
The engine receives width and height as FreeJ2ME settings; its canvas keeps
those logical dimensions while fractional CSS scaling preserves aspect ratio
and uses the existing pixelated rendering path.

Per the implementation request, no tests were added or run. The automated
browser-coverage criterion remains unchecked; `npm run build` completed
successfully.
