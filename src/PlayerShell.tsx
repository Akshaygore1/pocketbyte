import { useEffect, useRef, useState } from "react";

import {
  CheerpJFrameRuntimeAdapter,
  type PlayerLifecycleState,
  type RuntimeLifecycleEvent,
} from "./runtime/runtimeAdapter";
import { validateJar, type JarReview } from "./validation/validateJar";

const fixture = { id: "smoke-fixture", name: "Redistributable smoke fixture" };

interface PlayerView {
  state: PlayerLifecycleState;
  frameLabel: string;
}

function reduceRuntimeEvent(
  current: PlayerView,
  event: RuntimeLifecycleEvent,
): PlayerView {
  switch (event.type) {
    case "runtime-ready":
      return current.state === "loading-runtime"
        ? { ...current, state: "empty" }
        : current;
    case "launching":
      return current.state === "empty" || current.state === "launching"
        ? { ...current, state: "launching" }
        : current;
    case "running":
      return current.state === "launching" || current.state === "restarting"
        ? { state: "running", frameLabel: event.fixtureName }
        : current;
    case "restarting":
      return current.state === "running" || current.state === "restarting"
        ? { ...current, state: "restarting" }
        : current;
    case "failed":
      return ["empty", "loading-runtime", "launching", "running", "restarting"]
        .includes(current.state)
        ? { state: "failed", frameLabel: event.message }
        : current;
    case "diagnostics":
    case "teardown":
      return current;
  }
}

export function PlayerShell() {
  const frameContainer = useRef<HTMLDivElement>(null);
  const adapter = useRef<CheerpJFrameRuntimeAdapter | null>(null);
  const validationAttempt = useRef(0);
  const [player, setPlayer] = useState<PlayerView>({
    state: "loading-runtime",
    frameLabel: "Loading runtime frame…",
  });
  const [review, setReview] = useState<JarReview | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    const runtime = new CheerpJFrameRuntimeAdapter();
    adapter.current = runtime;
    const unsubscribe = runtime.subscribe((event) => {
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

  async function inspectSelectedJar(file: File | undefined): Promise<void> {
    if (!file) return;

    const attempt = validationAttempt.current + 1;
    validationAttempt.current = attempt;
    setReview(null);
    setValidationError(null);
    setPlayer((current) => ({ ...current, state: "validating" }));

    const result = await validateJar(file);
    if (validationAttempt.current !== attempt) return;

    if (!result.ok) {
      setValidationError(result.error.message);
      setPlayer((current) => ({ ...current, state: "failed" }));
      return;
    }

    setReview(result.metadata);
    setPlayer((current) => ({ ...current, state: "ready" }));
  }

  return (
    <main>
      <h1>Handset</h1>
      <p data-player-state={player.state} aria-live="polite">
        {player.state.replace("-", " ")}
      </p>
      <section aria-labelledby="local-jar-heading">
        <h2 id="local-jar-heading">Inspect a local game</h2>
        <label>
          Choose a Java ME JAR
          <input
            type="file"
            accept=".jar,application/java-archive"
            disabled={player.state === "validating"}
            onChange={(event) => void inspectSelectedJar(event.currentTarget.files?.[0])}
          />
        </label>
        <p>Your selected game stays in this browser and is not uploaded.</p>
        {validationError && <p role="alert">{validationError}</p>}
        {review && <JarMetadataReview review={review} />}
      </section>
      <button
        type="button"
        disabled={player.state !== "empty"}
        onClick={() => void adapter.current?.launch(fixture)}
      >
        Launch fixture
      </button>
      <section aria-label="Emulator display">
        <p>{player.frameLabel}</p>
        <div ref={frameContainer} />
      </section>
    </main>
  );
}

function JarMetadataReview({ review }: { review: JarReview }) {
  const suiteFields = [
    ["Suite name", review.suiteName],
    ["Vendor", review.vendor],
    ["Version", review.version],
    ["Icon", review.icon],
    ["Profile", review.profile],
    ["Configuration", review.configuration],
  ] as const;

  return (
    <section aria-labelledby="jar-review-heading">
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
            <strong>{midlet.name}</strong>
            {midlet.icon && <> — {midlet.icon}</>}
            <span> — {midlet.className}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
