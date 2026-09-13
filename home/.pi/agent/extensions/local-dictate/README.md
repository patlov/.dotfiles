# Local Dictate

Private, local voice dictation for Pi using `whisper.cpp` and Whisper Large-v3-Turbo.

- Press `ctrl+space` to start recording and press it again to transcribe.
- Press `ctrl+shift+space` to cancel an active recording or transcription.
- The footer shows a live microphone meter and transcription status.
- Dictated text is appended to the focused Pi input, including extension dialogs.

## Runtime lifecycle

The extension starts `whisper-server` lazily on the first dictation. Recording begins immediately while the model loads. The server remains warm for follow-up dictations and stops after 30 minutes without a completed or cancelled dictation. Pi also stops its server and recorder processes during session shutdown.

Each Pi process owns its server on a dynamically allocated loopback port. This avoids port conflicts, though simultaneous Pi processes can each load a model.

## Files and dependencies

The dotfiles installer provides `sox` and `whisper.cpp`. It downloads the quantized model to mutable, untracked user data:

```text
~/.local/share/pi-local-dictate/models/ggml-large-v3-turbo-q5_0.bin
```

The server binds only to `127.0.0.1`. Audio and transcripts are not sent over the network.

Optional environment overrides:

- `PI_DICTATE_MODEL` — GGML model path
- `PI_DICTATE_SERVER` — `whisper-server` executable
- `PI_DICTATE_REC` — SoX `rec` executable
- `PI_DICTATE_LANGUAGE` — Whisper language code; defaults to `en`

## Troubleshooting

After installation or extension edits, run `/reload` in Pi.

To verify that Pi receives the shortcut, launch it with `DICTATE_DEBUG=1 pi`, press `ctrl+space`, then inspect `${TMPDIR:-/tmp}/dictate-debug.log`. A working input path records `global input listener installed` followed by a `toggle-key` entry.

If the meter appears but remains flat, grant the terminal application microphone access in macOS System Settings under **Privacy & Security → Microphone**.

## Attribution

The focus-aware TUI interaction, global shortcuts, microphone meter, and lifecycle design are adapted from [`amosblomqvist/pi-dictate`](https://github.com/amosblomqvist/pi-dictate), used under its MIT license. See `THIRD_PARTY_NOTICES.md`.
