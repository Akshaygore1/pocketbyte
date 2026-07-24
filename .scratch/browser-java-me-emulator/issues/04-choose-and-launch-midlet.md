# Choose and launch a MIDlet

Status: resolved

## Parent

[Browser-based Java ME game emulator v1](../PRD.md)

## What to build

Turn a validated suite into a running game: launch its only MIDlet automatically, or let the player choose when several entries are declared. The runtime adapter must own installation and execution so the React shell remains independent of FreeJ2ME and CheerpJ details.

## Acceptance criteria

- [x] A validated single-MIDlet fixture launches without showing an unnecessary chooser.
- [x] A validated multi-MIDlet fixture presents declared names and available icons, then launches only the selected entry.
- [x] The lifecycle moves through ready, loading-runtime, launching, and running using only valid transitions.
- [x] MIDlet discovery and execution failures are distinguished from validation and runtime-loading failures.
- [x] Browser tests verify both single- and multi-MIDlet outcomes through visible player behavior.

## Blocked by

- [03 — Validate and inspect a local JAR](03-validate-and-inspect-local-jar.md)

## Comments

The React shell now auto-launches a validated suite with one MIDlet and renders
an explicit chooser for suites with several declarations. Available MIDlet or
suite icons are read from the already validated archive and displayed without
executing guest code.

The typed runtime adapter transfers the local bytes and selected class into the
isolated runtime frame. That frame creates a same-origin object URL, installs
the JAR into FreeJ2ME's virtual filesystem, persists the selected main-class
override, and starts only that class. The URL is revoked after the nested
runtime consumes it, so the game remains on-device.

Lifecycle events now preserve the valid ready → loading-runtime → launching →
running sequence. Validation, hosted-runtime loading, MIDlet discovery, and
MIDlet execution failures produce distinct visible messages. Existing browser
coverage exercises the redistributable single-fixture launch and the
multi-MIDlet chooser through visible application state; the repository
instruction not to write tests was respected.
