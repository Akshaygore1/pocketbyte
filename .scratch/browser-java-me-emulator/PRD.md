# Browser-based Java ME game emulator v1

Status: ready-for-agent

## Problem Statement

People who remember playing Java ME `.jar` games on late-2000s Nokia-style phones no longer have a convenient way to recreate that experience on a desktop browser. A game JAR is not a normal modern Java application: it expects a CLDC/MIDP virtual machine, phone graphics and media APIs, keypad events, device-specific dimensions, and RecordStore persistence. Building that runtime from scratch would obscure the actual product goal, while distributing old commercial game binaries would introduce avoidable copyright concerns.

The first milestone is deliberately narrow: prove that one user-supplied game can be loaded locally and played in desktop Chrome through a nostalgic phone-shaped interface. The implementation must nevertheless establish clean boundaries for a future platform that can attempt more games without coupling the product shell to one emulator engine.

## Solution

Build a client-only desktop Chrome application that lets a player select a Java ME JAR from their computer, validates it locally, displays its MIDlet metadata, and launches it through the existing FreeJ2ME-Web engine running on CheerpJ. The application presents the game inside an unbranded late-2000s candy-bar phone shell, routes an agreed physical-keyboard layout to the emulator, supports preset logical resolutions, and preserves the JAR, settings, and native RecordStore data locally.

The uploaded game never leaves the device and guest-game networking is denied. The CheerpJ runtime may still load its required runtime assets from its community CDN. The emulator runs behind a replaceable frame-and-adapter boundary so lifecycle operations and future engine changes do not spread through the React application.

The first compatibility fixture is the user's copy of *Prince of Persia: The Forgotten Sands*. It remains outside the repository and is used only for manual acceptance. Version 1 is complete only when that game reaches responsive gameplay and passes the agreed ten-minute stability smoke test in desktop Chrome.

## User Stories

1. As a nostalgic player, I want to select a Java ME JAR from my computer, so that I can try an old phone game in Chrome.
2. As a privacy-conscious player, I want the selected JAR to remain on my device, so that my game file is never uploaded to a server.
3. As a player, I want the application to reject files that are not valid JAR archives, so that failures are explained before an emulator starts.
4. As a player, I want desktop Java archives to be rejected as unsupported, so that the product does not imply every `.jar` file is a Java ME game.
5. As a player, I want oversized or suspicious archives to be rejected safely, so that malformed input cannot exhaust browser resources.
6. As a player, I want to see the MIDlet name, vendor, version, icon, profile, and configuration when available, so that I can verify what I selected.
7. As a player, I want a single-MIDlet suite to launch without an unnecessary chooser, so that the common path is quick.
8. As a player, I want to choose a MIDlet when a suite contains several, so that the application does not launch the wrong entry.
9. As a player, I want visible validation and runtime-loading states, so that a slow first launch does not look frozen.
10. As a player, I want the game to appear inside a recognizable phone-shaped object, so that the experience evokes playing on an old handset.
11. As a player, I want the phone shell to be unbranded, so that nostalgia does not depend on copying a particular Nokia model or trademark.
12. As a keyboard player, I want arrow keys to operate the directional pad, so that movement feels immediate.
13. As a keyboard player, I want Enter to operate the center or fire key, so that primary actions use a familiar key.
14. As a keyboard player, I want Q and W to operate the left and right soft keys, so that menu actions remain reachable.
15. As a keyboard player, I want the number row to map to phone digits, so that games using numeric controls remain playable.
16. As a keyboard player, I want E and R to map to `*` and `#`, so that every phone key has a physical-keyboard equivalent.
17. As a player, I want the decorative keypad to show the relevant phone controls, so that I can understand the old input model.
18. As a desktop player, I want the game to capture supported keys only while the player has focus, so that browser and application controls remain predictable.
19. As a player, I want to select from common Java ME screen resolutions, so that I can match different game builds.
20. As a player, I want the available presets to include 128×160, 176×208, 240×320, 320×240, 360×640, and 480×800, so that common portrait and landscape builds are covered.
21. As a player, I want a resolution change to restart the emulator with a warning, so that the game can recalculate its layout without silently losing volatile progress.
22. As a player, I want my selected resolution to be remembered, so that I do not have to reconfigure the same game every session.
23. As a player, I want the game display to preserve its aspect ratio, so that artwork is never stretched.
24. As a player, I want enlarged low-resolution output to remain pixel-sharp, so that scaling does not blur the original graphics.
25. As a player, I want the complete phone shell to fit within the browser window, so that controls and status remain visible.
26. As a player, I want an optional fullscreen mode, so that I can play without surrounding browser distractions.
27. As a player, I want fullscreen to preserve the logical game resolution, so that entering fullscreen does not alter game behavior.
28. As a player, I want Escape to exit browser fullscreen before it opens application settings, so that fullscreen follows normal browser conventions.
29. As a player, I want the game's Java ME audio to play, so that gameplay retains its music and effects.
30. As a player, I want a mute control, so that I can silence the game without changing system volume.
31. As a player, I want audio initialization to respect Chrome's user-gesture requirements, so that autoplay restrictions do not break launch.
32. As a player, I want unsupported media to fail gracefully, so that one audio format does not necessarily make a game unplayable.
33. As a returning player, I want native RecordStore data to survive refreshes and emulator restarts, so that normal in-game progress is retained.
34. As a player, I want resolution changes to retain native saves, so that experimenting with display settings does not erase progress.
35. As a player, I want saves isolated by the JAR's content hash, so that different game files cannot overwrite one another.
36. As a player, I want a clear-game-data action with confirmation, so that I can reset a game intentionally.
37. As a returning player, I want Chrome to remember the last selected JAR locally, so that I can resume without browsing for the file again.
38. As a returning player, I want a clear resume-last-game action, so that cached content is never launched unexpectedly.
39. As a player, I want a remove-game action, so that I can delete both the cached JAR and its associated saves.
40. As a security-conscious player, I want guest MIDlets to be offline-only, so that untrusted game code cannot make arbitrary network requests.
41. As a player, I want the application to distinguish guest-network denial from required emulator-runtime loading, so that the privacy promise is accurate.
42. As a player, I want Escape to open a settings overlay without passing accidental input into the game, so that I can change player settings safely.
43. As a player, I want the settings overlay not to claim a true pause, so that I understand the game clock may continue.
44. As a player, I want a failed launch to identify whether validation, runtime loading, MIDlet discovery, or execution failed, so that the error is actionable.
45. As a player, I want raw diagnostic details hidden behind a disclosure, so that ordinary errors remain readable.
46. As a developer, I want to copy diagnostic logs, so that compatibility failures can be investigated efficiently.
47. As a player, I want a failed emulator instance to be reset without reloading the whole product shell, so that recovery is quick.
48. As a project owner, I want the platform interface separated from FreeJ2ME and CheerpJ, so that another emulator engine can be evaluated later.
49. As a project owner, I want the first version to target one supplied game rather than claim universal compatibility, so that success is measurable.
50. As a project owner, I want commercial game binaries excluded from source control and application bundles, so that the project does not redistribute them.
51. As a developer, I want automated tests to use small non-copyrighted fixtures, so that the test suite is safe to share.
52. As a developer, I want runtime lifecycle events represented explicitly, so that loading, running, restarting, and failure states cannot conflict.
53. As a developer, I want input mapping centralized at one boundary, so that the React shell does not depend on FreeJ2ME internals.
54. As a developer, I want storage behavior centralized at one boundary, so that JAR bytes, settings, and saves remain consistently scoped.
55. As a project owner, I want the application to remain client-only for v1, so that the proof of concept has no operational backend burden.
56. As a project owner, I want the supplied game to survive ten continuous minutes of play in Chrome, so that the result demonstrates real gameplay rather than merely reaching a title screen.

## Implementation Decisions

- The checked-out FreeJ2ME-Web codebase is the emulator foundation. It already integrates a FreeJ2ME fork with CheerpJ, Canvas rendering, keyboard and pointer event delivery, MIDI and media bridges, launcher storage, screen configuration, and RecordStore support. Version 1 adapts this engine instead of implementing a JVM, CLDC, or MIDP runtime.
- The product shell will use Vite, React, and TypeScript and will remain client-only. The existing vanilla launcher is reference behavior and engine infrastructure; the new shell owns product flow and presentation.
- CheerpJ Community is acceptable for this personal toy project. The tested runtime version should be pinned, required attribution retained, and its hosted runtime dependency made visible in project documentation. A future commercial or self-hosted product must revisit CheerpJ licensing.
- The emulator will execute within a dedicated frame controlled through a typed runtime adapter. The shell communicates in lifecycle commands and events rather than reaching into FreeJ2ME internals throughout the component tree.
- The runtime adapter owns launch, focus, keyboard input, resolution, mute, restart, reset, diagnostics, and teardown. Replacing the engine should require a new adapter implementation rather than changes across the product UI.
- The player lifecycle will have explicit empty, validating, ready, loading-runtime, launching, running, restarting, and failed states. Only valid transitions expose their corresponding controls.
- The first implementation activity is a compatibility spike that launches the supplied Prince of Persia JAR through the checked-out engine. Polished interface work follows only after the engine reaches gameplay or the incompatibility is understood.
- If the touch-capable supplied build does not respond to keyboard input, the preferred fallback is a lawfully obtained keypad-oriented build of the same game. Adding pointer or clickable-phone controls is not a v1 fallback.
- Upload validation happens before emulator installation. A candidate must be no larger than 20 MB, be a structurally valid ZIP/JAR, contain no dangerous archive paths, remain under a safe decompressed-size and entry-count budget, contain `META-INF/MANIFEST.MF`, and declare at least one `MIDlet-*` entry.
- Validation extracts displayable metadata without executing guest bytecode. It reports the suite name, vendor, version, icon, MIDP profile, CLDC configuration, and MIDlet entries when present.
- A suite with one MIDlet launches that entry automatically. A suite with multiple MIDlets presents a chooser based on manifest names and icons.
- Uploaded JAR bytes, parsed metadata, selected MIDlet, selected resolution, mute preference, and last-game reference are stored locally in IndexedDB.
- Each JAR receives a SHA-256 content identity. RecordStore data and shell settings are namespaced by that identity so differently named copies of the same bytes share the intended data while different bytes remain isolated.
- The product offers “Resume last game,” “Remove game,” and “Clear game data” as distinct actions. Removing a game deletes the cached JAR and its associated persistent data after confirmation.
- The resolution selector provides exactly six presets in v1: 128×160, 176×208, 240×320, 320×240, 360×640, and 480×800. The engine's analysis may suggest an initial preset; the supplied test JAR defaults to 480×800 unless compatibility testing proves another preset correct.
- Changing logical resolution warns about unsaved volatile progress, preserves RecordStore data, tears down the active emulator frame, and launches a fresh instance with the new dimensions. Live logical resizing is not supported.
- CSS display scaling preserves aspect ratio and uses pixelated/nearest-neighbor rendering for enlargement. The logical canvas size remains independent of fullscreen and browser-window size.
- The agreed keyboard map is arrows for direction, Enter for center/fire, Q and W for the two soft keys, `0`–`9` for digits, and E/R for `*`/`#`. Input translation remains centralized in the runtime adapter.
- The phone keypad is visible but not clickable. It is a visual control reference and part of the hardware metaphor; all game control in v1 uses the physical keyboard.
- Escape follows layered behavior: browser fullscreen consumes it first; otherwise it opens the product settings overlay. The overlay captures game keys but does not promise that guest execution is suspended.
- The visual design is an unbranded late-2000s candy-bar handset with a matte graphite body, restrained metallic detail, a subtle screen glow, and a quiet dark background. Settings and status UI remain modern and readable rather than imitating a phone operating system.
- Audio support uses the engine's MIDI and media bridges. The product initializes audio after an eligible user gesture, exposes mute state, and distinguishes a media failure from a fatal game failure where possible.
- Fullscreen applies to the whole phone shell, preserves aspect ratio, and does not alter the selected logical resolution.
- RecordStore persistence uses the engine's storage facilities behind the product storage boundary. It survives refreshes, emulator restarts, and resolution changes.
- Guest MIDlet network APIs are denied or intercepted. Content Security Policy and runtime configuration may allow only the assets needed to boot the application and CheerpJ; this runtime exception must not become general guest network access.
- The application never transmits, republishes, or checks in a user-selected JAR. The supplied commercial game remains outside the repository.
- Failure reporting identifies the latest completed lifecycle stage and captures a sanitized diagnostic log. The main error stays concise; detailed traces appear only in a collapsible panel with a copy action.
- The application makes no promise that every Java ME game will work. Compatibility errors recommend trying another resolution and make the selected runtime settings part of copied diagnostics.
- If FreeJ2ME-Web cannot run the supplied game after a bounded compatibility investigation, the adapter boundary is used to evaluate another existing browser Java ME engine. Building a new VM remains out of scope and any material license or architecture change returns for user confirmation.

## Testing Decisions

- The primary test seam is the application as observed in desktop Chrome from a local HTTP server: select a JAR, inspect metadata, launch a MIDlet, play through the emulator frame, change player settings, refresh, resume, and remove data. This is the highest seam that exercises the React shell, runtime adapter, FreeJ2ME-Web, CheerpJ, browser storage, input, rendering, and media together.
- Browser tests should assert externally visible states and user outcomes rather than component structure, private adapter methods, CheerpJ internals, or exact DOM nesting.
- A small, redistributable Java ME fixture suite will cover automated launch behavior. It should render an identifiable frame, echo key events, write and read RecordStore data, expose multiple MIDlet entries in a second fixture, attempt a controlled network request, and optionally play a known supported sound.
- The user's Prince of Persia JAR is a manual acceptance fixture only. It must never be copied into source control, test snapshots, build output, logs, or shared artifacts.
- The supplied game acceptance path must reach actual responsive gameplay, verify the complete keyboard map needed by the game, verify working audio and mute, change resolution and restart, refresh and observe persisted game data, enter and leave fullscreen, and remain stable for ten continuous minutes.
- Guest networking is tested at the browser seam with a controlled fixture that attempts a request to a test endpoint. The observed result must be denial while CheerpJ runtime assets remain able to load.
- Upload validation is additionally tested below the browser seam because malformed archives are expensive and unsafe to exercise only through full runtime launches. Cases include wrong extensions, non-ZIP bytes, missing manifests, no MIDlet declaration, multiple MIDlets, oversized compressed input, excessive expansion, excessive entries, absolute paths, parent traversal, duplicate critical entries, and malformed manifest continuation lines.
- Storage behavior is additionally tested at the product storage seam for SHA-256 identity, last-game restoration, per-JAR isolation, resolution-setting retention, save retention, clear-data behavior, and complete removal.
- Runtime-adapter contract tests use a controlled fake frame to verify lifecycle ordering, message validation, keyboard mapping, restart teardown, error propagation, diagnostics, and protection from stale events emitted by a destroyed frame.
- Display tests verify the selected logical canvas dimensions and externally visible aspect-ratio behavior. They do not assert browser-specific antialiasing internals.
- Audio tests distinguish initialization, mute state, media failure, and fatal runtime failure. Browser tests begin from a user gesture so Chrome's autoplay policy is exercised rather than bypassed.
- Fullscreen tests verify the shell is the fullscreen element, the logical resolution does not change, and Escape exits fullscreen before opening settings.
- Resolution tests verify every preset, restart warning, emulator recreation, retained persistent data, and unchanged aspect ratio. They do not require every arbitrary game build to render correctly at every preset.
- Failure tests cover validation, runtime loading, MIDlet discovery, and guest execution stages and verify that a user can copy sanitized diagnostics.
- Existing prior art is limited: the checked-out engine contains media-library test assets and established event-queue/key-mapping behavior, but no general automated browser suite for the launcher/player flow. The new browser-level suite therefore becomes the primary product prior art.
- A good test remains deterministic, uses redistributable fixtures, observes behavior at the highest practical seam, and fails on a user-visible contract change rather than an internal refactor.

## Out of Scope

- Production deployment, hosting configuration, domains, telemetry, analytics, or operational monitoring
- A backend, accounts, authentication, cloud saves, sharing, or cross-device synchronization
- Public hosting, bundling, downloading, cataloging, or redistributing commercial game JARs
- A multi-game library beyond remembering and resuming the last locally selected JAR
- Universal Java ME compatibility or a compatibility database
- Desktop Java SE JAR execution
- Building a JVM, CLDC implementation, MIDP implementation, or Java bytecode interpreter from scratch
- Mobile-browser, Firefox, Safari, or Edge acceptance targets
- Clickable phone keys, mouse gameplay, touch gameplay, or mobile on-screen controls
- Reproduction of a named Nokia handset, Nokia logos, or other branded industrial design
- Separate JAD upload support
- Arbitrary custom resolutions outside the six presets
- Live resolution changes without emulator restart
- True guest-process pause or suspension
- Emulator-level instant save states
- Guest networking, multiplayer, dead-service proxies, or restoration of old online services
- Guaranteeing every audio codec, vendor API, 3D API, or device quirk
- Commercial CheerpJ licensing or self-hosting its runtime

## Further Notes

- The current repository is an unmodified checkout of `zb3/freej2me-web` at commit `c19416e75cbc15f9a27f7e967ee81cb108761e30`. Its upstream GitHub issue tracker is not this toy project's issue tracker; this PRD is published to the configured local Markdown tracker.
- The inspected manual fixture has SHA-256 `ee92e6a1f82bf2af7fb712466f666f6356a06ba53cc46c14c857fcaa07c6ea18`.
- Its manifest identifies *Prince of Persia: The Forgotten Sands*, version `1.0.5`, vendor `Gameloft SA`, `CLDC-1.1`, and `MIDP-2.0`, with entry class `GloftPP10`.
- Static inspection found standard LCDUI Canvas, media Player, and RecordStore dependencies and no obvious Nokia-specific APIs. It contains both keyboard and pointer handlers and declares touch support, so keyboard playability remains the first compatibility risk.
- The fixture's large size and 480-pixel-wide packaged artwork suggest a high-resolution touch build. The 480×800 starting preset is an informed inference, not a guarantee; the resolution selector and compatibility spike resolve the actual behavior.
- The current FreeJ2ME-Web engine is GPL-3.0-or-later and includes separately licensed dependencies. CheerpJ uses its Community License for eligible personal and open-source use and requires hosted runtime access and attribution. Licensing must be reevaluated before the project changes ownership, distribution model, or commercial posture.
- “Offline-only guest” means no network requested by MIDlet code. It does not mean the whole page can boot without internet while using the community-hosted CheerpJ runtime.
- The approved completion gate is the full Chrome acceptance path plus ten minutes of continuous gameplay, not merely parsing the JAR or rendering the title screen.
