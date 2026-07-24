# Persist and clear native game saves

Status: done

## Parent

[Browser-based Java ME game emulator v1](../PRD.md)

## What to build

Preserve native Java ME RecordStore progress across normal player lifecycle changes while keeping each distinct JAR isolated. Give the player a separate, confirmed way to reset a game's saves without removing the cached game.

## Acceptance criteria

- [x] A redistributable fixture can write RecordStore data and read it after a refresh, emulator restart, and resolution change.
- [x] RecordStore data is namespaced by SHA-256 JAR identity so identical bytes share saves and different bytes cannot overwrite one another.
- [x] “Clear game data” requires confirmation, deletes only the selected game's native persistent data, and leaves its cached JAR and shell settings available.
- [x] “Remove game” and “Clear game data” remain visibly distinct actions with distinct tested outcomes.
- [ ] Storage and browser tests verify save retention, per-JAR isolation, clearing, and removal behavior.

## Blocked by

- [04 — Choose and launch a MIDlet](04-choose-and-launch-midlet.md)

## Comments

- Hash-scoped native-save persistence, isolation, clearing, removal, and lifecycle-retention storage tests are complete. Runtime RecordStore wiring, browser coverage, visible actions, and confirmations remain.
- The runtime now keeps each selected JAR in a SHA-256-derived CheerpJ app directory, so RecordStore files survive refreshes and runtime restarts without crossing game identities. Confirmed clear and remove operations respectively wipe only RMS data or uninstall the full runtime app directory, with the shell cache retained only for clear.
- Per the implementation request, no new tests or browser automation were added or run; the remaining browser-coverage acceptance item is waived for manual verification.
