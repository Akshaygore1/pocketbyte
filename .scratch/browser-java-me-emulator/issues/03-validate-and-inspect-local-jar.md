# Validate and inspect a local JAR

Status: resolved

## Parent

[Browser-based Java ME game emulator v1](../PRD.md)

## What to build

Let a player select a local JAR, reject unsafe or unsupported input before emulator installation, calculate its SHA-256 content identity, and review its declared Java ME metadata without executing guest bytecode. Validation failures must be understandable and must not leave a partially installed game.

## Acceptance criteria

- [x] The player can select a `.jar` file no larger than 20 MB and sees visible validating, ready, or failed states.
- [x] Structurally invalid archives, missing manifests, suites without a `MIDlet-*` declaration, desktop Java archives, dangerous paths, duplicate critical entries, excessive entry counts, and excessive decompressed sizes are rejected before launch.
- [x] Manifest continuation lines and multiple MIDlet declarations are parsed safely without executing guest code.
- [x] Available suite name, vendor, version, icon, profile, configuration, and MIDlet entries are displayed for player review.
- [x] SHA-256 identity is derived from the JAR bytes, and automated malformed-archive tests cover every validation budget and rejection class from the PRD.
- [x] The selected JAR remains local and is never transmitted by the validation or metadata flow.

## Blocked by

- [02 — Establish an adapter-controlled fixture launch](02-establish-adapter-controlled-fixture-launch.md)

## Comments

Implemented the local-only validation boundary in `src/validation/validateJar.ts`, backed by a bounded ZIP inspector and manifest parser in `src/jar/`. It verifies the 20 MB compressed-input limit, entry and expanded-content budgets, safe paths, duplicate manifests, central/local ZIP consistency, supported compression, checksums, manifest safety, Java ME MIDlet declarations, and desktop-JAR rejection. Deflate output is capped by declared and globally budgeted sizes. It derives SHA-256 from the exact local bytes and returns display-ready metadata and failures without evaluating guest classes or using a network boundary. Public-seam tests cover every rejection category and malformed-input budget. Player file-selection states and rendered metadata remain to be integrated in the shell.

### 2026-07-25 player integration

Integrated local JAR selection into `PlayerShell` with explicit validating,
ready, and failed states. Successful validation displays every available suite
field plus all declared MIDlets; rejection messages remain visible and no
metadata from a failed selection is retained. The runtime-ready event is
guarded so it cannot overwrite an in-progress or completed validation state.

Public shell tests verify the visible state transitions, metadata review,
pre-read extension rejection, and local-only messaging. The installed desktop
Google Chrome also passes the browser-level local-JAR review path.
