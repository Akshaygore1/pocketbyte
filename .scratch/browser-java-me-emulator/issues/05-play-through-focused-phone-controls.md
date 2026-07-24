# Play through the focused phone controls

Status: resolved

## Parent

[Browser-based Java ME game emulator v1](../PRD.md)

## What to build

Present the running game inside an unbranded late-2000s candy-bar handset and make the complete agreed physical-keyboard layout playable. The decorative keypad must teach the old input model while input delivery remains centralized and scoped to an intentionally focused player.

## Acceptance criteria

- [x] The running canvas appears inside a responsive matte-graphite phone shell whose full body and status UI fit in the desktop viewport.
- [x] Arrows, Enter, Q, W, digits `0`–`9`, E, and R map respectively to directions, center/fire, soft keys, phone digits, `*`, and `#`.
- [x] The decorative keypad visibly communicates the relevant controls but is not clickable or touch-enabled.
- [x] Supported keys are prevented from triggering browser behavior only while the player has focus, and settings or other application controls do not leak key events to the game.
- [ ] Adapter contract tests verify centralized key translation, keydown/keyup ordering, focus behavior, and rejection of stale-frame events.
- [x] The redistributable fixture visibly echoes enough inputs for a browser test to verify the complete mapping.

## Blocked by

- [04 — Choose and launch a MIDlet](04-choose-and-launch-midlet.md)

## Comments

The React shell now presents the runtime in a responsive matte-graphite
candy-bar handset. Its visible keypad documents every agreed keyboard control
without exposing pointer interactions. The focusable handset filters supported
physical keys, routes ordered press/release commands through the runtime
adapter, and releases held keys when focus leaves the player.

Shell-controlled runtime mode disables the legacy engine's aggressive canvas
refocus loop, keeping physical input at the adapter boundary while leaving the
standalone launcher unchanged. The redistributable fixture visibly echoes the
mapped input; manual Chrome verification exercised the full boundary with
`E` displayed as `*`.

No test files were added or changed because the repository's `AGENTS.md`
explicitly says not to write tests. Existing unit, build, and browser suites
pass, including stale-frame rejection, but the requested expanded adapter
contract coverage remains unchecked to record that instruction conflict.
