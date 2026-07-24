/*
 * Copyright 2026 FreeJ2ME-Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
package fixtures;

import javax.microedition.lcdui.Canvas;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Graphics;
import javax.microedition.midlet.MIDlet;
import javax.microedition.midlet.MIDletStateChangeException;

public final class RuntimeSmokeMidlet extends MIDlet {
    private final Canvas screen = new Canvas(true) {
        private String status = "FREEJ2ME FIXTURE";

        protected void paint(Graphics graphics) {
            graphics.setColor(0x17304a);
            graphics.fillRect(0, 0, getWidth(), getHeight());
            graphics.setColor(0xf4d35e);
            graphics.drawString(
                status,
                getWidth() / 2,
                getHeight() / 2,
                Graphics.HCENTER | Graphics.TOP
            );
        }

        public void keyPressed(int keyCode) {
            status = "KEY " + getKeyName(keyCode);
            repaint();
        }
    };

    protected void startApp() throws MIDletStateChangeException {
        Display.getDisplay(this).setCurrent(screen);
    }

    protected void pauseApp() {
    }

    protected void destroyApp(boolean unconditional)
        throws MIDletStateChangeException {
    }
}
