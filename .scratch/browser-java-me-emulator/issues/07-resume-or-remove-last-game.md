# Resume or remove the last game

Status: done

## Parent

[Browser-based Java ME game emulator v1](../PRD.md)

## What to build

Remember the most recently selected game locally without launching it unexpectedly. A returning player must be able to explicitly resume it or remove its cached JAR and associated data after confirmation.

## Acceptance criteria

- [x] Validated JAR bytes, parsed metadata, selected MIDlet, mute preference, selected resolution, and the last-game reference are stored locally in IndexedDB under the JAR content identity.
- [x] Refreshing the application presents a clear “Resume last game” action and never launches cached guest code automatically.
- [x] Resuming restores the cached game and its player settings without requiring another file selection.
- [x] Removing a game requires confirmation and deletes its cached JAR, shell settings, last-game reference, and associated persistent game data.
- [x] Storage tests verify restoration, content-hash identity, differently named identical files, different-file isolation, and complete removal.

## Blocked by

- [04 — Choose and launch a MIDlet](04-choose-and-launch-midlet.md)

## Comments

- The product storage boundary and deterministic IndexedDB tests are complete. Shell integration, visible resume/remove controls, and confirmation behavior remain.
- The shell now restores the last-game summary without launching it, resumes the saved MIDlet and resolution only after an explicit action, and confirms complete removal.
