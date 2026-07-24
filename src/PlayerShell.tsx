import { useEffect, useRef, useState } from "react";

import {
  CheerpJFrameRuntimeAdapter,
  type PlayerLifecycleState,
  type RuntimeLifecycleEvent,
} from "./runtime/runtimeAdapter";
import { validateJar, type JarReview } from "./validation/validateJar";

const fixture = { id: "smoke-fixture", name: "Redistributable smoke fixture" };

function stateFor(event: RuntimeLifecycleEvent): PlayerLifecycleState | null {
  switch (event.type) {
    case "runtime-ready": return "empty";
    case "launching": return "launching";
    case "running": return "running";
    case "restarting": return "restarting";
    case "failed": return "failed";
    default: return null;
  }
}

export function PlayerShell() {
  const frameContainer = useRef<HTMLDivElement>(null);
  const adapter = useRef<CheerpJFrameRuntimeAdapter | null>(null);
  const validationAttempt = useRef(0);
  const [state, setState] = useState<PlayerLifecycleState>("loading-runtime");
  const [frameLabel, setFrameLabel] = useState("Loading runtime frame…");
  const [review, setReview] = useState<JarReview | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    const runtime = new CheerpJFrameRuntimeAdapter();
    adapter.current = runtime;
    const unsubscribe = runtime.subscribe((event) => {
      const nextState = stateFor(event);
      if (nextState === "empty") {
        setState((current) => current === "loading-runtime" ? "empty" : current);
      } else if (nextState) {
        setState(nextState);
      }
      if (event.type === "running") setFrameLabel(event.fixtureName);
      if (event.type === "failed") setFrameLabel(event.message);
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
    setState("validating");

    const result = await validateJar(file);
    if (validationAttempt.current !== attempt) return;

    if (!result.ok) {
      setValidationError(result.error.message);
      setState("failed");
      return;
    }

    setReview(result.metadata);
    setState("ready");
  }

  return (
    <main>
      <h1>Handset</h1>
      <p data-player-state={state} aria-live="polite">{state.replace("-", " ")}</p>
      <section aria-labelledby="local-jar-heading">
        <h2 id="local-jar-heading">Inspect a local game</h2>
        <label>
          Choose a Java ME JAR
          <input
            type="file"
            accept=".jar,application/java-archive"
            disabled={state === "validating"}
            onChange={(event) => void inspectSelectedJar(event.currentTarget.files?.[0])}
          />
        </label>
        <p>Your selected game stays in this browser and is not uploaded.</p>
        {validationError && <p role="alert">{validationError}</p>}
        {review && <JarMetadataReview review={review} />}
      </section>
      <button
        type="button"
        disabled={state !== "empty"}
        onClick={() => void adapter.current?.launch(fixture)}
      >
        Launch fixture
      </button>
      <section aria-label="Emulator display">
        <p>{frameLabel}</p>
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
