import { useEffect, useRef, useState } from "react";

import {
  CheerpJFrameRuntimeAdapter,
  type MidletLaunch,
  type PlayerLifecycleState,
  type RuntimeLifecycleEvent,
} from "./runtime/runtimeAdapter";
import { readValidatedJarResource } from "./jar/validateJar";
import { validateJar, type JarReview } from "./validation/validateJar";
import "./PlayerShell.css";

const fixture = { id: "smoke-fixture", name: "Redistributable smoke fixture" };

interface PlayerView {
  state: PlayerLifecycleState;
  frameLabel: string;
  runtimeError: string | null;
}

interface SelectedGame {
  identity: string;
  bytes: Uint8Array;
  review: JarReview;
  iconUrls: Map<number, string>;
}

function reduceRuntimeEvent(
  current: PlayerView,
  event: RuntimeLifecycleEvent,
): PlayerView {
  switch (event.type) {
    case "runtime-ready":
      return current.state === "loading-runtime"
        ? { ...current, state: "empty", runtimeError: null }
        : current;
    case "runtime-loading":
      return current.state === "ready"
        ? {
            state: "loading-runtime",
            frameLabel: `Loading the runtime for ${event.fixtureName}…`,
            runtimeError: null,
          }
        : current;
    case "launching":
      return ["empty", "loading-runtime", "launching"].includes(current.state)
        ? {
            ...current,
            state: "launching",
            frameLabel: `Launching ${event.fixtureName}…`,
          }
        : current;
    case "running":
      return current.state === "launching" || current.state === "restarting"
        ? {
            state: "running",
            frameLabel: event.fixtureName,
            runtimeError: null,
          }
        : current;
    case "restarting":
      return current.state === "running" || current.state === "restarting"
        ? { ...current, state: "restarting", runtimeError: null }
        : current;
    case "failed":
      return ["empty", "loading-runtime", "launching", "running", "restarting"]
        .includes(current.state)
        ? {
            state: "failed",
            frameLabel: event.message,
            runtimeError: `${failureStageLabel(event.stage)}: ${event.message}`,
          }
        : current;
    case "diagnostics":
    case "teardown":
      return current;
  }
}

export function PlayerShell() {
  const frameContainer = useRef<HTMLDivElement>(null);
  const phone = useRef<HTMLDivElement>(null);
  const adapter = useRef<CheerpJFrameRuntimeAdapter | null>(null);
  const pressedKeys = useRef(new Set<string>());
  const validationAttempt = useRef(0);
  const [player, setPlayer] = useState<PlayerView>({
    state: "loading-runtime",
    frameLabel: "Loading runtime frame…",
    runtimeError: null,
  });
  const [selectedGame, setSelectedGame] = useState<SelectedGame | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [runtimeAvailable, setRuntimeAvailable] = useState(false);

  useEffect(() => {
    const runtime = new CheerpJFrameRuntimeAdapter();
    adapter.current = runtime;
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type === "runtime-ready") setRuntimeAvailable(true);
      setPlayer((current) => reduceRuntimeEvent(current, event));
    });
    runtime.mount(frameContainer.current!);
    return () => {
      validationAttempt.current += 1;
      unsubscribe();
      runtime.destroy();
      adapter.current = null;
    };
  }, []);

  useEffect(
    () => () => releaseIconUrls(selectedGame?.iconUrls),
    [selectedGame],
  );

  useEffect(() => {
    if (
      runtimeAvailable
      && player.state === "ready"
      && selectedGame?.review.midlets.length === 1
    ) {
      void launchMidlet(selectedGame, selectedGame.review.midlets[0]);
    }
  }, [player.state, runtimeAvailable, selectedGame]);

  useEffect(() => {
    if (player.state === "running") phone.current?.focus();
  }, [player.state]);

  async function inspectSelectedJar(file: File | undefined): Promise<void> {
    if (!file) return;

    const attempt = validationAttempt.current + 1;
    validationAttempt.current = attempt;
    setSelectedGame(null);
    setValidationError(null);
    setPlayer((current) => ({ ...current, state: "validating" }));

    const result = await validateJar(file);
    if (validationAttempt.current !== attempt) return;

    if (!result.ok) {
      setValidationError(result.error.message);
      setPlayer((current) => ({
        ...current,
        state: "failed",
        runtimeError: null,
      }));
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      setValidationError("The selected JAR could not be prepared for launch.");
      setPlayer((current) => ({
        ...current,
        state: "failed",
        runtimeError: null,
      }));
      return;
    }
    if (validationAttempt.current !== attempt) return;

    const game = {
      identity: result.sha256,
      bytes,
      review: result.metadata,
      iconUrls: createMidletIconUrls(bytes, result.metadata),
    };
    setSelectedGame(game);
    setPlayer((current) => ({
      ...current,
      state: "ready",
      runtimeError: null,
    }));

  }

  async function launchMidlet(
    game: SelectedGame,
    midlet: JarReview["midlets"][number],
  ): Promise<void> {
    const launch: MidletLaunch = {
      identity: game.identity,
      name: midlet.name,
      className: midlet.className,
      jarBytes: game.bytes,
    };
    await adapter.current?.launchMidlet(launch);
  }

  function sendKey(code: string, pressed: boolean): boolean {
    if (pressed) {
      if (pressedKeys.current.has(code)) return true;
      if (!adapter.current?.input(code, true)) return false;
      pressedKeys.current.add(code);
    } else {
      if (!pressedKeys.current.delete(code)) return false;
      adapter.current?.input(code, false);
    }
    return true;
  }

  function releasePressedKeys(): void {
    pressedKeys.current.forEach((code) => adapter.current?.input(code, false));
    pressedKeys.current.clear();
  }

  return (
    <main className="player-shell">
      <section className="player-copy" aria-labelledby="product-title">
        <div>
          <p className="eyebrow">Local Java ME player</p>
          <h1 id="product-title">Handset</h1>
          <p className="intro">
            Bring back a game from your own collection. It stays on this
            device, from inspection through play.
          </p>
        </div>

        <section className="game-loader" aria-labelledby="local-jar-heading">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Game cartridge</p>
              <h2 id="local-jar-heading">Choose a game</h2>
            </div>
            <span className="privacy-mark">On-device</span>
          </div>
          <label className="file-picker">
            <span>Choose a Java ME JAR</span>
            <input
              type="file"
              accept=".jar,application/java-archive"
              disabled={player.state === "validating"}
              onChange={(event) =>
                void inspectSelectedJar(event.currentTarget.files?.[0])}
            />
          </label>
          <p className="privacy-copy">
            Your selected game stays in this browser and is not uploaded.
          </p>
          {validationError && <p className="alert" role="alert">{validationError}</p>}
          {player.runtimeError && <p className="alert" role="alert">{player.runtimeError}</p>}
          {selectedGame && (
            <JarMetadataReview
              game={selectedGame}
              state={player.state}
              onLaunch={(midlet) => void launchMidlet(selectedGame, midlet)}
            />
          )}
          <button
            className="fixture-launch"
            type="button"
            disabled={player.state !== "empty"}
            onClick={() => void adapter.current?.launch(fixture)}
          >
            Launch fixture
          </button>
        </section>

        <aside className="keyboard-legend" aria-label="Keyboard controls">
          <p>Focus the phone, then play with your keyboard.</p>
          <span><kbd>Q</kbd><kbd>W</kbd> soft keys</span>
          <span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> move</span>
          <span><kbd>Enter</kbd> select</span>
        </aside>
      </section>

      <section className="phone-stage" aria-label="Emulator display">
        <div
          ref={phone}
          className="phone"
          role="application"
          aria-label="Java ME phone player. Focus to use keyboard controls."
          tabIndex={0}
          onPointerDown={(event) => {
            event.preventDefault();
            phone.current?.focus();
          }}
          onKeyDown={(event) => {
            if (sendKey(event.code, true)) event.preventDefault();
          }}
          onKeyUp={(event) => {
            if (sendKey(event.code, false)) event.preventDefault();
          }}
          onBlur={releasePressedKeys}
        >
          <div className="phone-cap">
            <span className="earpiece" />
            <span className="status-light" aria-hidden="true" />
          </div>
          <div className="screen-bezel">
            <div className="screen-status">
              <span
                className={`state-indicator state-${player.state}`}
                aria-hidden="true"
              />
              <span data-player-state={player.state} aria-live="polite">
                {player.state.replace("-", " ")}
              </span>
              <span className="screen-clock" aria-hidden="true">J2ME</span>
            </div>
            <div className="runtime-viewport" ref={frameContainer}>
              <p className="runtime-label">{player.frameLabel}</p>
            </div>
          </div>
          <PhoneControls />
          <div className="phone-foot" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </section>
    </main>
  );
}

function PhoneControls() {
  const digitKeys = [
    ["1", ""],
    ["2", "ABC"],
    ["3", "DEF"],
    ["4", "GHI"],
    ["5", "JKL"],
    ["6", "MNO"],
    ["7", "PQRS"],
    ["8", "TUV"],
    ["9", "WXYZ"],
    ["*", "E"],
    ["0", "+"],
    ["#", "R"],
  ] as const;

  return (
    <div className="phone-controls" data-phone-control aria-hidden="true">
      <div className="soft-key-row">
        <div className="hardware-key soft-key">
          <span className="key-cap">Q</span>
          <span className="key-function">Left</span>
        </div>
        <div className="navigation-key">
          <span className="nav-up">↑</span>
          <span className="nav-left">←</span>
          <span className="nav-center">Enter</span>
          <span className="nav-right">→</span>
          <span className="nav-down">↓</span>
        </div>
        <div className="hardware-key soft-key">
          <span className="key-cap">W</span>
          <span className="key-function">Right</span>
        </div>
      </div>
      <div className="number-pad">
        {digitKeys.map(([digit, letters]) => (
          <div className="hardware-key digit-key" key={digit}>
            <span className="key-cap">{digit}</span>
            {letters && <span className="key-function">{letters}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function JarMetadataReview({
  game,
  state,
  onLaunch,
}: {
  game: SelectedGame;
  state: PlayerLifecycleState;
  onLaunch: (midlet: JarReview["midlets"][number]) => void;
}) {
  const { review } = game;
  const suiteFields = [
    ["Suite name", review.suiteName],
    ["Vendor", review.vendor],
    ["Version", review.version],
    ["Icon", review.icon],
    ["Profile", review.profile],
    ["Configuration", review.configuration],
  ] as const;

  return (
    <section className="jar-review" aria-labelledby="jar-review-heading">
      <h2 id="jar-review-heading">Game details</h2>
      <dl>
        {suiteFields.map(([label, value]) => value && (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>MIDlets</h3>
      <ol>
        {review.midlets.map((midlet) => (
          <li key={midlet.index}>
            {game.iconUrls.get(midlet.index) && (
              <img
                src={game.iconUrls.get(midlet.index)}
                alt=""
                width="48"
                height="48"
              />
            )}
            <strong>{midlet.name}</strong>
            {midlet.icon && <> — {midlet.icon}</>}
            <span> — {midlet.className}</span>
            {review.midlets.length > 1 && (
              <button
                type="button"
                aria-label={`Launch ${midlet.name}`}
                disabled={state !== "ready"}
                onClick={() => onLaunch(midlet)}
              >
                Launch
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function createMidletIconUrls(
  bytes: Uint8Array,
  review: JarReview,
): Map<number, string> {
  const urls = new Map<number, string>();
  if (typeof URL.createObjectURL !== "function") return urls;

  for (const midlet of review.midlets) {
    const iconPath = midlet.icon ?? review.icon;
    if (!iconPath) continue;
    const iconBytes = readValidatedJarResource(bytes, iconPath);
    if (!iconBytes) continue;
    urls.set(
      midlet.index,
      URL.createObjectURL(
        new Blob([Uint8Array.from(iconBytes)], {
          type: iconMimeType(iconPath),
        }),
      ),
    );
  }
  return urls;
}

function releaseIconUrls(urls: Map<number, string> | undefined): void {
  if (typeof URL.revokeObjectURL !== "function") return;
  urls?.forEach((url) => URL.revokeObjectURL(url));
}

function iconMimeType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "gif") return "image/gif";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  return "image/png";
}

function failureStageLabel(stage: string): string {
  switch (stage) {
    case "runtime-loading":
      return "Runtime loading failed";
    case "midlet-discovery":
      return "MIDlet discovery failed";
    case "execution":
      return "MIDlet execution failed";
    default:
      return "Launch failed";
  }
}
