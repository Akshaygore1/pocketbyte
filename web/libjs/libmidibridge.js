export default {
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_getMidiPlayer(lib) {
        return window.libmidi?.midiPlayer ?? null;
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiSetSequence(lib, player, sequence) {
        if (player && sequence) {
            try {
                await player.setSequence(sequence.buffer);
                return player.duration;
            } catch (error) {
                const details = String(error?.message ?? error).toLowerCase();
                if (
                    !error
                    || error?.name === "NotSupportedError"
                    || /decode|format|invalid|unsupported/.test(details)
                ) {
                    window.reportRecoverableMediaError?.(
                        "One MIDI track could not be decoded. Gameplay can continue without it.",
                    );
                } else {
                    throw error;
                }
            }
        }
        return -1;
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiPlay(lib, player) {
        player?.play();
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiLoop(lib, player, times) {
        player?.loop(times);
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiStop(lib, player) {
        player?.stop();
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiShortEvent(lib, player, status, data1, data2) {
        player?.shortEvent(status, data1, data2);
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiGetPosition(lib, player) {
        return player ? await player.getPosition() : 0;
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiSeek(lib, player, pos) {
        player?.seek(pos);
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiGetVolume(lib, player) {
        return player?.volume ?? 0;
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiSetVolume(lib, player, vol) {
        if (player) player.volume = vol;
    },
}
