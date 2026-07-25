import { LibMedia } from "../libmedia/libmedia.js";
import { LibMidi, createUnlockingAudioContext } from "../libmidi/libmidi.js";
import { codeMap, KeyRepeatManager } from "./key.js";
import { EventQueue } from "./eventqueue.js";
import { initKbdListeners, setKbdHandler, kbdWidth, kbdHeight } from "./screenKbd.js";

// we need to import natives here, don't use System.loadLibrary
// since CheerpJ fails to load them in firefox and we can't set breakpoints
import canvasFontNatives from "../libjs/libcanvasfont.js";
import canvasGraphicsNatives from "../libjs/libcanvasgraphics.js";
import gles2Natives from "../libjs/libgles2.js";
import jsReferenceNatives from "../libjs/libjsreference.js";
import mediaBridgeNatives from "../libjs/libmediabridge.js";
import midiBridgeNatives from "../libjs/libmidibridge.js";

const evtQueue = new EventQueue();
const sp = new URLSearchParams(location.search);

const cheerpjWebRoot = '/app'+location.pathname.replace(/\/[^/]*$/,'');

let isMobile = sp.get('mobile');
const shellControls = sp.get('shellControls') === '1';

let display = null;
let screenCtx = null;

let fractionScale = sp.get('fractionScale') || (localStorage && localStorage.getItem("pl.zb3.freej2me.fractionScale") === "true");
let scaleSet = false;

const keyRepeatManager = new KeyRepeatManager();

window.evtQueue = evtQueue;

function autoscale() {
    if (!scaleSet) return;

    let screenWidth = window.innerWidth;
    let screenHeight = window.innerHeight;

    if (isMobile) {
        document.getElementById('left-keys').style.display = '';
        document.getElementById('right-keys').style.display = '';

        if (screenWidth > screenHeight) {
            document.body.classList.add('kbd-landscape');
            document.body.classList.remove('kbd-portrait');
            screenWidth = screenWidth - 2*kbdWidth;
        } else {
            document.body.classList.add('kbd-portrait');
            document.body.classList.remove('kbd-landscape');
            screenHeight = screenHeight - kbdHeight;
        }
    }

    let scale = Math.min(
        screenWidth/screenCtx.canvas.width,
        screenHeight/screenCtx.canvas.height
    );

    if (!fractionScale) {
        scale = scale|0;
    }

    display.style.zoom = scale;
}

function setListeners() {
    let mouseDown = false;
    let noMouse = false;

    setKbdHandler((isDown, key) => {
        const symbol = key.startsWith('Digit') ? key.substring(5) : '\x00';
        keyRepeatManager.post(isDown, key, {symbol, ctrlKey: false, shiftKey: false});
    });

    function handleKeyEvent(e) {
        const isDown = e.type === 'keydown';

        if (codeMap[e.code]) {
            keyRepeatManager.post(isDown, e.code, {
                symbol: e.key.length == 1 ? e.key.charCodeAt(0) : '\x00',
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey
            })
        }
        e.preventDefault();
    }

    display.addEventListener('keydown', handleKeyEvent);
    display.addEventListener('keyup', handleKeyEvent);

    keyRepeatManager.register((kind, key, args) => {
        if (kind === 'click') {
            if (key === 'Maximize') {
                fractionScale = !fractionScale;
                localStorage && localStorage.setItem("pl.zb3.freej2me.fractionScale", fractionScale);
                autoscale();
            }
        } else if (codeMap[key]) {
            console.log('queuin event');
            evtQueue.queueEvent({
                kind: kind === 'up' ? 'keyup' : 'keydown',
                args: [codeMap[key], args.symbol, args.ctrlKey, args.shiftKey]
            });
        }
    });

    display.addEventListener('mousedown', async e => {
        display.focus();
        if (noMouse) return;

        evtQueue.queueEvent({
            kind: 'pointerpressed',
            x: e.offsetX / display.currentCSSZoom | 0,
            y: e.offsetY / display.currentCSSZoom | 0,
        });

        mouseDown = true;

        e.preventDefault();
    });

    display.addEventListener('mousemove', async e => {
        if (noMouse) return;
        if (!mouseDown) return;

        evtQueue.queueEvent({
            kind: 'pointerdragged',
            x: e.offsetX / display.currentCSSZoom | 0,
            y: e.offsetY / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    });

    document.addEventListener('mouseup', async e => {
        if (noMouse) return;
        if (!mouseDown) return;

        mouseDown = false;

        evtQueue.queueEvent({
            kind: 'pointerreleased',
            x: (e.pageX - display.offsetLeft) / display.currentCSSZoom | 0,
            y: (e.pageY - display.offsetTop) / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    });


    display.addEventListener('touchstart', async e => {
        display.focus();
        noMouse = true;

        evtQueue.queueEvent({
            kind: 'pointerpressed',
            x: (e.changedTouches[0].pageX - display.offsetLeft) / display.currentCSSZoom | 0,
            y: (e.changedTouches[0].pageY - display.offsetTop) / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    }, {passive: false});

    display.addEventListener('touchmove', async e => {
        noMouse = true;

        evtQueue.queueEvent({
            kind: 'pointerdragged',
            x: (e.changedTouches[0].pageX - display.offsetLeft) / display.currentCSSZoom | 0,
            y: (e.changedTouches[0].pageY - display.offsetTop) / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    }, {passive: false});

    display.addEventListener('touchend', async e => {
        noMouse = true;

        evtQueue.queueEvent({
            kind: 'pointerreleased',
            x: (e.changedTouches[0].pageX - display.offsetLeft) / display.currentCSSZoom | 0,
            y: (e.changedTouches[0].pageY - display.offsetTop) / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    });

    if (!shellControls) {
        document.addEventListener('mousedown', () => {
            console.log('refocus');
            setTimeout(() => display.focus(), 20);
        });

        display.addEventListener('blur', () => {
            console.log('refocus');
            // it doesn't work without any timeout
            setTimeout(() => display.focus(), 10);
        });
    }

    window.addEventListener('resize', autoscale);

    initKbdListeners();
}

function setFaviconFromBuffer(arrayBuffer) {
    const blob = new Blob([arrayBuffer], { type: 'image/png' });

    const reader = new FileReader();
    reader.onload = function() {
        const dataURL = reader.result;

        let link = document.querySelector("link[rel*='icon']");
        if (!link) {
            link = document.createElement('link');
            link.setAttribute('rel', 'icon');
            document.head.appendChild(link);
        }
        link.setAttribute('href', dataURL);
    };
    reader.readAsDataURL(blob);
}

async function ensureAppInstalled(lib, appId) {
    const appFile = await cjFileBlob(appId + "/app.jar");

    if (!appFile) {
        const launcherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;

        await launcherUtil.installFromBundle(cheerpjWebRoot + "/apps/", appId);
    }
}

async function init() {
    const notifyHost = (type, details = {}) => {
        if (window.parent !== window) {
            window.parent.postMessage({
                source: "freej2me-engine",
                type,
                ...details,
            }, location.origin);
        }
    };
    let failureStage = "runtime-loading";
    let audioMuted = sp.get("muted") === "1";
    let audioFixtureStarted = false;

    try {
        document.getElementById("loading").textContent = "Loading CheerpJ...";

        display = document.getElementById('display');
        screenCtx = display.getContext('2d');

        setListeners();

        window.reportRecoverableMediaError = message => {
            notifyHost("media-warning", { message });
        };
        window.libmedia = new LibMedia(window.reportRecoverableMediaError);
        const applyMutedState = () => {
            window.libmidi?.setMuted(audioMuted);
            window.libmedia.setMuted(audioMuted);
        };
        try {
            window.libmidi = new LibMidi(createUnlockingAudioContext());
            await window.libmidi.init();
            window.libmidi.midiPlayer.addEventListener('end-of-media', e => {
                window.evtQueue.queueEvent({kind: 'player-eom', player: e.target});
            })
        } catch (error) {
            window.libmidi = null;
            window.reportRecoverableMediaError(
                "MIDI audio is unavailable, but gameplay can continue.",
            );
        }
        applyMutedState();
        window.handsetAudio = {
            async initialize() {
                const tasks = [window.libmedia.resume()];
                if (window.libmidi) tasks.push(window.libmidi.resume());
                await Promise.all(tasks);
                if (
                    sp.get("audioFixture") === "1"
                    && window.libmidi
                    && !audioFixtureStarted
                ) {
                    const fixtureResponse = await fetch(
                        new URL("../libmidi/test/koko.mid", import.meta.url),
                    );
                    if (!fixtureResponse.ok) {
                        throw new Error("The audio fixture could not be loaded.");
                    }
                    audioFixtureStarted = true;
                    await window.libmidi.midiPlayer.setSequence(
                        await fixtureResponse.arrayBuffer(),
                    );
                    window.libmidi.midiPlayer.play();
                }
                applyMutedState();
                return { muted: audioMuted };
            },
            setMuted(muted) {
                audioMuted = Boolean(muted);
                applyMutedState();
            },
        };

        await cheerpjInit({
        enableDebug: false,
        natives: {
            ...canvasFontNatives,
            ...canvasGraphicsNatives,
            ...gles2Natives,
            ...jsReferenceNatives,
            ...mediaBridgeNatives,
            ...midiBridgeNatives,
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setTitle(lib, title) {
                document.title = title;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setIcon(lib, iconBytes) {
                if (iconBytes) {
                    setFaviconFromBuffer(iconBytes.buffer);
                }
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_getScreenCtx(lib) {
                return screenCtx;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setCanvasSize(lib, width, height) {
                if (!scaleSet) {
                    document.getElementById('loading').hidden = true;
                    display.style.display = '';
                    scaleSet = true;
                    display.focus();
                }
                screenCtx.canvas.width = width;
                screenCtx.canvas.height = height;
                autoscale();
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_waitForAndDispatchEvents(lib, listener) {
                const KeyEvent = await lib.pl.zb3.freej2me.bridge.shell.KeyEvent;
                const PointerEvent = await lib.pl.zb3.freej2me.bridge.shell.PointerEvent;

                const evt = await evtQueue.waitForEvent();
                if (evt.kind == 'keydown') {
                    await listener.keyPressed(await new KeyEvent(...evt.args));
                } else if (evt.kind == 'keyup') {
                    await listener.keyReleased(await new KeyEvent(...evt.args));
                } else if (evt.kind == 'pointerpressed') {
                    await listener.pointerPressed(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind == 'pointerdragged') {
                    await listener.pointerDragged(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind == 'pointerreleased') {
                    await listener.pointerReleased(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind == 'player-eom') {
                    await listener.playerEOM(evt.player);
                } else if (evt.kind == 'player-video-frame') {
                    await listener.playerVideoFrame(evt.player);
                }
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_restart(lib) {
                location.reload();
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_exit(lib) {
                location.href = './';
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_sthop(lib) {
                debugger;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_say(lib, sth) {
                console.log('[say]', sth);
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_sayObject(lib, label, obj) {
                debugger;
                console.log('[sayobject]', label, obj);
            }
        }
        });

        document.getElementById("loading").textContent = "Loading...";

        const lib = await cheerpjRunLibrary(cheerpjWebRoot+"/freej2me-web.jar");

        const operation = sp.get("operation");
        if (operation) {
            failureStage = "game-data-operation";
            const identity = sp.get("identity");
            const requestId = sp.get("requestId");
            if (!identity || !/^[a-f0-9]{64}$/.test(identity) || !requestId) {
                throw new Error("The game data request is invalid.");
            }

            const LauncherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;
            const File = await lib.java.io.File;
            const appId = `handset_${identity}`;
            let deletedPath;
            let deletionError;
            if (operation === "clear-game-data") {
                deletedPath = `${appId}/rms`;
                deletionError = "The runtime could not clear the game's saved progress.";
                await LauncherUtil.wipeAppData(appId);
            } else if (operation === "remove-game") {
                deletedPath = appId;
                deletionError = "The runtime could not remove the game's local data.";
                await LauncherUtil.uninstallApp(appId);
            } else {
                throw new Error("The game data operation is not supported.");
            }
            const deletedFile = await new File(deletedPath);
            if (await deletedFile.exists()) {
                throw new Error(deletionError);
            }
            notifyHost("operation-complete", { requestId });
            return;
        }

        const FreeJ2ME = await lib.org.recompile.freej2me.FreeJ2ME;

        let args;

        if (sp.get('launchUrl')) {
            failureStage = "midlet-discovery";
            const response = await fetch(sp.get('launchUrl'));
            if (!response.ok) throw new Error("The selected JAR could not be opened.");
            const jarBytes = await response.arrayBuffer();
            notifyHost("launch-consumed");

            const identity = sp.get('identity');
            const className = sp.get('main');
            if (!identity || !className) {
                throw new Error("The selected MIDlet declaration is incomplete.");
            }

            const LauncherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;
            const MIDletLoader = await lib.org.recompile.mobile.MIDletLoader;
            const File = await lib.java.io.File;
            const HashMap = await lib.java.util.HashMap;
            const jarFile = await new File(`/files/_tmp/${identity}.jar`);
            await LauncherUtil.copyJar(new Int8Array(jarBytes), jarFile);
            const loader = await MIDletLoader.getMIDletLoader(jarFile);
            if (!loader) throw new Error("FreeJ2ME could not inspect the selected JAR.");

            const appId = `handset_${identity}`;
            await loader.setAppId(appId);
            const settings = await new HashMap();
            await settings.put("main", className);
            const requestedWidth = sp.get("width");
            const requestedHeight = sp.get("height");
            if (requestedWidth && requestedHeight) {
                const rotateDisplay =
                    Number(requestedHeight) > Number(requestedWidth);
                await settings.put("width", requestedWidth);
                await settings.put("height", requestedHeight);
                await settings.put("rotate", rotateDisplay ? "on" : "off");
            }
            await LauncherUtil.initApp(jarFile, loader, settings, null, null);
            args = ['app', appId];
        } else if (sp.get('app')) {
            const app = sp.get('app');
            await ensureAppInstalled(lib, app);
            args = ['app', sp.get('app')];
        } else {
            args = ['jar', cheerpjWebRoot+"/jar/" + (sp.get('jar') || "game.jar")];
        }

        failureStage = "execution";
        notifyHost("launching");
        FreeJ2ME.main(args).catch(e => {
            e.printStackTrace();
            document.getElementById('loading').textContent = 'Crash :(';
            notifyHost("failed", {
                stage: "execution",
                message: `${sp.get('name') || "The MIDlet"} could not start.`,
            });
        });
    } catch (error) {
        document.getElementById('loading').textContent = 'Launch failed';
        notifyHost("failed", {
            stage: failureStage,
            message: error instanceof Error ? error.message : "The launch failed.",
        });
    }

}

init();
