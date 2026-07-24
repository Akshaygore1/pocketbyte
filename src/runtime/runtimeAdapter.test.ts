import { describe, expect, it, vi } from "vitest";

import {
  CheerpJFrameRuntimeAdapter,
  type RuntimeFrameFactory,
  type RuntimeLifecycleEvent,
} from "./runtimeAdapter";

class ControlledFrame {
  readonly element = document.createElement("iframe");
  readonly contentWindow = {
    postMessage: vi.fn(),
  };

  constructor() {
    Object.defineProperty(this.element, "contentWindow", {
      configurable: true,
      value: this.contentWindow,
    });
  }

  emit(event: Record<string, unknown>) {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: event,
        source: this.contentWindow as unknown as MessageEventSource,
      }),
    );
  }
}

function fixtureFrameFactory(frame: ControlledFrame): RuntimeFrameFactory {
  return {
    create: () => frame.element,
  };
}

describe("CheerpJFrameRuntimeAdapter", () => {
  it("accepts only validated lifecycle events from its live frame session", async () => {
    const frame = new ControlledFrame();
    const adapter = new CheerpJFrameRuntimeAdapter(fixtureFrameFactory(frame));
    const events: RuntimeLifecycleEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.mount(document.body);
    frame.element.dispatchEvent(new Event("load"));
    const session = adapter.session;

    frame.emit({
      source: "freej2me-runtime-frame",
      session,
      type: "runtime-ready",
    });
    frame.emit({
      source: "freej2me-runtime-frame",
      session: "stale-session",
      type: "running",
      fixtureName: "Ignored",
    });
    frame.emit({ source: "untrusted", session, type: "failed" });

    expect(events).toEqual([
      { type: "diagnostics", message: "Runtime frame mounted" },
      { type: "runtime-ready" },
    ]);

    await adapter.launch({ id: "smoke", name: "Redistributable smoke fixture" });
    expect(frame.contentWindow.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "launch", session }),
      window.location.origin,
    );

    adapter.destroy();
    frame.emit({
      source: "freej2me-runtime-frame",
      session,
      type: "running",
      fixtureName: "Stale fixture",
    });

    expect(events).toEqual([
      { type: "diagnostics", message: "Runtime frame mounted" },
      { type: "runtime-ready" },
      { type: "launching", fixtureName: "Redistributable smoke fixture" },
      { type: "teardown" },
    ]);
  });
});
