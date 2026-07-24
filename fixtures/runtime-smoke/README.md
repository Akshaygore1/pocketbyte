# Runtime smoke fixture

This tiny GPL-3.0-or-later MIDlet is the redistributable browser acceptance
fixture. It renders an identifiable frame through the real FreeJ2ME-Web and
CheerpJ runtime and echoes pressed keys.

To rebuild `web/jar/runtime-smoke.jar`, compile
`src/fixtures/RuntimeSmokeMidlet.java` against `web/freej2me-web.jar` with a
Java 8 compiler, then package every generated `fixtures/*.class` file with
`MANIFEST.MF`.
