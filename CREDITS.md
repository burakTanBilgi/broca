# Credits

## Runs

- `edge-tts` (LGPL-3.0, one file MIT), run as a separate program through `uvx`; it reaches Microsoft's online voices by an unofficial route. Only the spoken line's text is sent.
- `ffmpeg` (LGPL/GPL), run as a separate program, decodes the voice to PCM.
- PipeWire's `pw-play` and `pw-record` (MIT), run as separate programs: the sound out, the microphone's loudness in. `mpv` (GPL) is the optional other player.
- Claude Code's transcript files (`~/.claude/projects/<folder>/<session>.jsonl`), read only, format observed by reading it, not a documented API.

## Carried over

A few lines in `src/voice.ts` come from an earlier voice project of the author, no import: how `edge-tts` is called (`--voice`, `--text`, the `--text=` form for text that starts with a dash), the process-group kill for a launcher that runs the real program as its own child, and the voice name `en-US-BrianMultilingualNeural`.
