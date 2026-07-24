# Establish an adapter-controlled fixture launch

Status: blocked

## Parent

[Browser-based Java ME game emulator v1](../PRD.md)

## What to build

Create the smallest client-only React and TypeScript player that launches a redistributable Java ME fixture through a dedicated emulator frame and typed runtime adapter. The visible flow must progress through explicit lifecycle states to an identifiable rendered frame, establishing the replaceable engine boundary before product features accumulate.

## Acceptance criteria

- [ ] A local desktop Chrome session can open the product shell and launch a redistributable fixture through the FreeJ2ME-Web/CheerpJ frame.
- [x] The shell communicates with the frame only through validated lifecycle commands and events for launch, focus, input, restart, failure, diagnostics, and teardown.
- [x] Empty, loading-runtime, launching, running, restarting, and failed states are explicit, and stale events from a destroyed frame cannot alter the current player.
- [x] The tested CheerpJ version is pinned, its required attribution and hosted-runtime dependency are documented, and the project remains client-only.
- [x] A browser-level smoke test observes the fixture reaching its identifiable rendered state without depending on component structure or engine internals.

## Comments

### 2026-07-25 adapter and fixture-shell implementation

Implemented the typed, session-scoped frame contract in
`src/runtime/runtimeAdapter.ts` and a minimal React lifecycle shell in
`src/PlayerShell.tsx`. The shell only sends validated lifecycle commands
(`initialize`, launch, focus, input, restart, diagnostics, and teardown) and
only accepts events from the current iframe window and session. Teardown
removes its listener before the frame can affect a subsequent player.

`web/runtime-frame.html` provides a redistributable, no-game-bytes smoke fixture
that renders an identifiable canvas frame. `e2e/fixture-launch.spec.ts` observes
the visible running state and the rendered frame rather than component nesting or
engine internals. The focused adapter contract test passes.

The browser smoke test could not run locally because this workspace lacks the
Playwright Chromium executable. The production FreeJ2ME/CheerpJ bridge remains
blocked by ticket 01's unavailable external compatibility fixture; the pinned
CheerpJ `20260317_2978` hosted-runtime dependency and attribution are documented
in `README.md`.

### 2026-07-25 Chrome verification

Configured Playwright to use the installed Google Chrome channel and verified
the redistributable fixture reaches its identifiable rendered canvas through
the session-scoped frame adapter. The browser smoke test passes without
inspecting React component structure or engine internals.

The production FreeJ2ME/CheerpJ game bridge and first acceptance criterion
remain blocked by ticket 01: the lawful external compatibility JAR is still
unavailable. No commercial game bytes were added to the repository.

## Blocked by

- [01 — Prove supplied-game compatibility](01-prove-supplied-game-compatibility.md)
