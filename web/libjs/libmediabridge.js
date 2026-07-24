// this needs to be run on the main thread
// assuming window.libmedia has the instance and contexte
export default {
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_createMediaPlayer(lib) {
        const player = window.libmedia.createMediaPlayer();
        player.addEventListener('end-of-media', e => {
            window.evtQueue.queueEvent({kind: 'player-eom', player: e.target});
        })
        return player;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerLoad(lib, player, data, contentType) {
        try {
            const loaded = await player.load(data.buffer, contentType);
            if (!loaded) {
                window.reportRecoverableMediaError?.(
                    `This game's ${contentType || "media"} format is not supported. Gameplay can continue without it.`,
                );
            }
            return loaded;
        } catch (error) {
            if (
                error?.name === "NotSupportedError"
                || error?.name === "EncodingError"
            ) {
                window.reportRecoverableMediaError?.(
                    "One media item could not be decoded. Gameplay can continue without it.",
                );
                return false;
            }
            throw error;
        }
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerPlay(lib, player) {
        await player.play();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerSetLooping(lib, player, loop) {
        player.setLooping(loop);
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerStop(lib, player) {
        player.stop();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetPosition(lib, player) {
        const pos = player.position;
        return pos;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetDuration(lib, player) {
        const pos = player.duration || -1;
        return pos;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerSeek(lib, player, pos) {
        player.seek(pos);
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerClose(lib, player) {
        player.close();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetVolume(lib, player) {
        return player.volume;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerSetVolume(lib, player, vol) {
        player.volume = vol;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerSetupVideo(lib, player, ctxObj, javaPlayerObj, x, y, w, h, fullscreen) {
        player.configureVideo(ctxObj, () => {
            //debugger;
            window.evtQueue.queueEvent(
                {kind: 'player-video-frame', player: javaPlayerObj},
                // skip if we already queued this event
                evt => evt.kind === 'player-video-frame' && evt.player === javaPlayerObj
            );
        }, x, y, w, h, fullscreen)
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetWidth(lib, player) {
        return player.videoWidth;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetHeight(lib, player) {
        return player.videoHeight;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetSnapshot(lib, player, type) {
        const buffer = await player.getSnapshot(type);
        return buffer ? new Int8Array(buffer) : null;
    },
}
