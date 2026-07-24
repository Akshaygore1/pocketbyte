import { expect, test } from "@playwright/test";

const validJar =
  "UEsDBBQAAAAIAFcO+VxgeKZ5tgAAACUBAAAUAAAATUVUQS1JTkYvTUFOSUZFU1QuTUZVjsEKgzAQRO+F/sN+gEmrvXkr2hahFqHiXXS1C5pIEsH+fRORYG+782ZnJ68FdagNq1BpkiKGkJ+PhzxLBzTsVY8YQ0niC++ZDHpQoWiliuFOi5kVwnU2H6n0jvu0iF+8nDVOO2mXxSfRW0CNkreWjHWzQsmOBvvR2gsWrUX2PJGio35WtdtiSJ5pwkIe+vhw6/qwtQM4GTu7LwHgUo/TgNzRnFrr9TfRdlNKOegA/r2reDz8AFBLAwQUAAAACABXDvlcLqTgtQ8AAAANAAAAGAAAAGV4YW1wbGUvVGlueU1pZGxldC5jbGFzc0vOSSwuVkjLrCgpLUoFAFBLAQIUABQAAAAIAFcO+VxgeKZ5tgAAACUBAAAUAAAAAAAAAAAAAAAAAAAAAABNRVRBLUlORi9NQU5JRkVTVC5NRlBLAQIUABQAAAAIAFcO+VwupOC1DwAAAA0AAAAYAAAAAAAAAAAAAAAAAOgAAABleGFtcGxlL1RpbnlNaWRsZXQuY2xhc3NQSwUGAAAAAAIAAgCIAAAALQEAAAAA";

test("a redistributable fixture reaches its rendered runtime frame", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("empty", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Launch fixture" }).click();

  await expect(page.getByText("running", { exact: true })).toBeVisible();
  const runtime = page.locator("iframe[data-runtime-frame]");
  await expect(runtime).toBeVisible();
  await expect(runtime.contentFrame().getByText("Redistributable smoke fixture")).toBeVisible();
  await expect(runtime.contentFrame().getByLabel("Redistributable smoke fixture rendered")).toBeVisible();
});

test("a local JAR is validated and displayed for review", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Choose a Java ME JAR").setInputFiles({
    name: "tiny.jar",
    mimeType: "application/java-archive",
    buffer: Buffer.from(validJar, "base64"),
  });

  await expect(page.getByText("ready", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Game details" })).toBeVisible();
  await expect(page.getByText("Tiny Suite")).toBeVisible();
  await expect(page.getByText("Fixture Authors")).toBeVisible();
  await expect(page.getByText("Tiny Game")).toBeVisible();
  await expect(page.getByText("Tiny Tools")).toBeVisible();
});
