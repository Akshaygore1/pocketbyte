# Prince of Persia: The Forgotten Sands compatibility investigation

Date: 2026-07-25

Outcome: blocked before game-specific analysis because the external acceptance fixture was unavailable

## Scope and fixture handling

This investigation was limited to the checked-out FreeJ2ME-Web engine and the
user's lawfully supplied, external JAR. The repository and the surrounding
Desktop locations were searched by filename only. No external game JAR was
found:

- `/Users/akshay/Desktop/retro` was searched recursively for `.jar` and `.jad`
  files.
- `/Users/akshay/Desktop` was searched to five directory levels for `.jar` and
  `.jad` files
  outside this repository.
- The only JARs found were the engine artifact already tracked at
  `web/freej2me-web.jar` and its generated `dist/freej2me-web.jar` build copy.

The commercial fixture was therefore not opened, copied, uploaded, installed,
logged, or written to source control, build output, snapshots, or test
artifacts during this run. The manifest and hash notes in the PRD are prior
static-inspection evidence; the fixture bytes that produced them were not
available to this investigation.

## Environment and harness evidence

The existing launcher was served locally with the repository's documented
Range-capable command:

```text
npx --yes serve -u web -l 4173
```

The browser-level harness reached its ready state with:

| Item | Observed value |
| --- | --- |
| Desktop browser | Google Chrome `150.0.7871.182` |
| CheerpJ loader | `https://cjrtnc.leaningtech.com/20260317_2978/loader.js` |
| Local launcher | `http://localhost:4173/` |
| Runtime evidence | Console reported `CheerpJ runtime ready` from the pinned runtime |
| Java launcher evidence | Loading UI was hidden, main launcher UI was shown, and the JAR picker was present and enabled |

The furthest verified lifecycle stage was:

```text
local page -> CheerpJ runtime -> freej2me-web.jar launcher -> enabled JAR picker
                                                            |
                                                            blocked: no external fixture
```

The visible launcher state recorded during the browser check was `Standard`,
`96x65`, and sound off, with rotate, force-fullscreen,
texture-disable-filter, and queued-paint flags off. It must not be treated as
the engine's fresh-install default or as a game setting: launcher data can be
persisted between sessions.

The checked-in engine source establishes the fresh per-app defaults instead:

- phone type: `Nokia`
- logical display: `240x320`
- sound: on
- rotate, force-fullscreen, texture-disable-filter, and queued-paint flags: off

The engine also exposes `Standard`, `Nokia`, `Siemens`, `Motorola`, and
`SonyEricsson` phone modes; its analyser can infer a vendor mode from a JAR
filename, manifest, or class signatures. Those capabilities are only
potential paths here because the supplied JAR was unavailable. In particular,
the PRD's `480x800` starting resolution remains an informed hypothesis and
was not exercised.

## Compatibility checks

| Check | Result | Evidence or constraint |
| --- | --- | --- |
| External JAR selection | Not run | Fixture absent |
| Analyzer/MIDlet discovery | Not run | The launcher could not cross the file-selection boundary |
| Logical resolution | Not tested for the game | `480x800` remains the planned first attempt |
| Phone/input configuration | Not tested for the game | Launcher baseline was `Standard`; physical key handling was not exercised against the MIDlet |
| Compatibility flags | None established | No guest bytecode was launched |
| Responsive gameplay | Not demonstrated | Blocked before analysis, not an observed engine incompatibility |
| Audio and mute | Not tested | No MIDlet media path was reached |
| RecordStore persistence | Not tested | No application was installed or launched |
| Continuous play | Not tested | Gameplay was not reached, so a ten-minute observation would be meaningless |

## Adapter constraints and next decision

This result does not justify switching engines or seeking another build. It
only proves that the existing browser harness can reach the local-selection
boundary in the tested Chrome/CheerpJ combination.

The next bounded step is to make the user's lawful JAR available outside the
repository and rerun this same engine first at `480x800`, recording the
analyzer-selected phone type before changing settings. Only an actual launch
failure or unresponsive gameplay would justify choosing between compatibility
flags, a lawful keypad-oriented build, or another engine. That decision
requires user confirmation after fixture-backed evidence; it is not expanded
silently by this investigation.

## Follow-up verification

The approved filename-only search and browser-boundary check were repeated on
2026-07-25 while implementing ticket 1:

- no external `.jar` or `.jad` was present in the workspace or the searched
  nearby Desktop scope;
- the local Range-capable server delivered `web/freej2me-web.jar` successfully;
- Chrome reached the enabled `Select JAR file` control;
- the console again reported `CheerpJ runtime ready`; and
- the loaded runtime scripts were pinned to CheerpJ `20260317_2978`.

The follow-up did not upload, inspect, copy, or log commercial game bytes.
Game-specific keyboard, audio, RecordStore, gameplay, and ten-minute stability
checks remain blocked on the same missing external fixture.
