# Changelog

## 0.1.2 — 2026-10-09

The default voice command pins edge-tts to 7.2.8 (`uvx edge-tts@7.2.8`), so a new release on PyPI never runs untested; set `ttsArgs` to change it.

## 0.1.1 — 2026-10-08

The waves scale themselves to the room's noise floor and the loudest recent level, so a quiet or hot microphone still shows the voice (found in the first live test: the input was at 13% and the wave stayed flat). "Listening" now means louder than the room by `listenRatio` (default 3), replacing the fixed `listenLevel`. While Broca speaks, the you wave is held flat because the microphone hears the speakers (not when `voiceStop` is on).

## 0.1.0 — 2026-10-08

First Broca: follows one chat's transcript, speaks each new `» ` line through edge-tts, draws your microphone and its own voice as waves, space stops, m mutes, q quits. Voice-stop is off and behind a setting.
