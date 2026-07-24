# Prove supplied-game compatibility

Status: blocked

## Parent

[Browser-based Java ME game emulator v1](../PRD.md)

## What to build

Prove that the user's external *Prince of Persia: The Forgotten Sands* JAR can reach responsive gameplay through the checked-out FreeJ2ME-Web engine in desktop Chrome. Record the working launch settings, keyboard behavior, audio behavior, stability observations, and any bounded incompatibility that must shape the product adapter. The commercial JAR and its contents must remain outside the repository and shared artifacts.

## Acceptance criteria

- [ ] The external JAR is launched locally through the existing engine without being copied into source control, build output, logs, snapshots, or shared test artifacts.
- [x] The investigation records the tested Chrome and CheerpJ versions, logical resolution, phone/input configuration, and any compatibility flags needed to reach the furthest working state.
- [x] Responsive gameplay is demonstrated, or the exact blocking stage and evidence are documented after a bounded investigation.
- [ ] Keyboard, audio, RecordStore, and continuous-play behavior are checked far enough to identify constraints for the runtime adapter.
- [x] If gameplay is reached, a ten-minute stability observation is recorded; if it is not reached, the next engine or lawful-build decision is returned for confirmation rather than silently expanding scope.

## Blocked by

External acceptance fixture unavailable in the searched workspace and nearby
Desktop scope.

## Comments

### 2026-07-25 compatibility investigation

Blocked before game-specific analysis because the external acceptance fixture
was not present under the retro workspace or the searched nearby Desktop
locations. The existing harness itself reached an enabled local JAR picker in
Google Chrome `150.0.7871.182` after the pinned CheerpJ
`20260317_2978` runtime reported ready. No commercial game bytes were copied,
opened, installed, logged, or added to repository artifacts.

The exact search scope, browser evidence, untested behavior, and retest
baseline are recorded in
[`docs/compatibility/prince-of-persia-forgotten-sands.md`](../../../docs/compatibility/prince-of-persia-forgotten-sands.md).
Provide the lawful external JAR outside the repository to resume this ticket.
The current evidence does not justify an engine switch or alternate-build
search.

### 2026-07-25 follow-up evidence check

The bounded filename-only search was repeated across the retro workspace and
nearby Desktop scope. It again found no external `.jar` or `.jad`; the sole
workspace JAR is the tracked `web/freej2me-web.jar` engine artifact. No game
content was opened, copied, installed, or logged.

The compatibility record was also corrected to distinguish the persisted
launcher UI state seen in Chrome from the engine's source-defined fresh-app
defaults: `Nokia`, `240x320`, sound on, and all tested compatibility toggles
off. The source confirms that the engine can analyse a supplied JAR for
vendor-mode hints and offers Standard/Nokia/Siemens/Motorola/SonyEricsson
phone modes, but no game-specific setting can be inferred without the lawful
fixture. Status remains `blocked`; the next action is unchanged: provide the
JAR outside the repository, then launch it first at the PRD's `480x800`
candidate and record the analyser result before changing settings.

### 2026-07-25 implementation recheck

Ticket 1 was rechecked at its desktop-Chrome seam. The local Range-capable
server delivered the checked-in engine, Chrome reached an enabled
`Select JAR file` control, and the console reported the pinned CheerpJ
`20260317_2978` runtime ready.

A repeated filename-only search found no external `.jar` or `.jad` in the
workspace or the searched nearby Desktop scope. The only results were
`web/freej2me-web.jar` and its generated `dist/freej2me-web.jar` copy. No
commercial game bytes were uploaded, inspected, copied, or logged. Keyboard,
audio, RecordStore, gameplay, and ten-minute stability acceptance remain
blocked until the lawful external fixture is supplied.
