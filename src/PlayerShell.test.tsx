import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlayerShell } from "./PlayerShell";

function validJar(): Uint8Array {
  const encoded =
    "UEsDBBQAAAAIAFcO+VxgeKZ5tgAAACUBAAAUAAAATUVUQS1JTkYvTUFOSUZFU1QuTUZVjsEKgzAQRO+F/sN+gEmrvXkr2hahFqHiXXS1C5pIEsH+fRORYG+782ZnJ68FdagNq1BpkiKGkJ+PhzxLBzTsVY8YQ0niC++ZDHpQoWiliuFOi5kVwnU2H6n0jvu0iF+8nDVOO2mXxSfRW0CNkreWjHWzQsmOBvvR2gsWrUX2PJGio35WtdtiSJ5pwkIe+vhw6/qwtQM4GTu7LwHgUo/TgNzRnFrr9TfRdlNKOegA/r2reDz8AFBLAwQUAAAACABXDvlcLqTgtQ8AAAANAAAAGAAAAGV4YW1wbGUvVGlueU1pZGxldC5jbGFzc0vOSSwuVkjLrCgpLUoFAFBLAQIUABQAAAAIAFcO+VxgeKZ5tgAAACUBAAAUAAAAAAAAAAAAAAAAAAAAAABNRVRBLUlORi9NQU5JRkVTVC5NRlBLAQIUABQAAAAIAFcO+VwupOC1DwAAAA0AAAAYAAAAAAAAAAAAAAAAAOgAAABleGFtcGxlL1RpbnlNaWRsZXQuY2xhc3NQSwUGAAAAAAIAAgCIAAAALQEAAAAA";
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

function deferredFile(bytes: Uint8Array, name = "tiny.jar") {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const file = {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => {
      await pending;
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
    },
  } as File;

  return { file, release };
}

afterEach(cleanup);

describe("PlayerShell local JAR review", () => {
  it("shows validating and then reviewed metadata without launching guest code", async () => {
    const jar = validJar();
    const selected = deferredFile(jar);
    vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockReturnValue({
      postMessage: vi.fn(),
    } as unknown as Window);
    render(<PlayerShell />);

    fireEvent.change(screen.getByLabelText("Choose a Java ME JAR"), {
      target: { files: [selected.file] },
    });

    expect(screen.getByText("validating", { exact: true })).toBeVisible();
    expect(screen.queryByText("Tiny Suite")).not.toBeInTheDocument();

    selected.release();

    await waitFor(() => {
      expect(screen.getByText("ready", { exact: true })).toBeVisible();
    });
    expect(screen.getByText("Tiny Suite")).toBeVisible();
    expect(screen.getByText("Fixture Authors")).toBeVisible();
    expect(screen.getByText("1.2.3")).toBeVisible();
    expect(screen.getByText("/suite.png")).toBeVisible();
    expect(screen.getByText("MIDP-2.0")).toBeVisible();
    expect(screen.getByText("CLDC-1.1")).toBeVisible();
    expect(screen.getByText("Tiny Game")).toBeVisible();
    expect(screen.getByText(/example\.TinyMidlet/)).toBeVisible();
    expect(screen.getByText("Tiny Tools")).toBeVisible();
  });

  it("explains rejected selections without reading or displaying them", async () => {
    const arrayBuffer = vi.fn<() => Promise<ArrayBuffer>>();
    const selected = {
      name: "desktop-app.zip",
      size: 128,
      arrayBuffer,
    } as unknown as File;
    vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockReturnValue({
      postMessage: vi.fn(),
    } as unknown as Window);
    render(<PlayerShell />);

    fireEvent.change(screen.getByLabelText("Choose a Java ME JAR"), {
      target: { files: [selected] },
    });

    await waitFor(() => {
      expect(screen.getByText("failed", { exact: true })).toBeVisible();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a Java ME .jar file.",
    );
    expect(screen.queryByRole("heading", { name: "Game details" }))
      .not.toBeInTheDocument();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
