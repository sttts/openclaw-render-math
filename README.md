# @sttts/openclaw-render-math

OpenClaw plugin that renders LaTeX math equations to PNG images — without
granting the agent `exec` permission.

## Why

OpenClaw's built-in [math-images skill](https://github.com/juntao/math-images-skill)
works great, but it reaches `math2img` through the generic `exec` /
`group:runtime` tool. That is fine in direct messages where the agent is
trusted, but in group chats you usually do **not** want to hand out `exec` to
everyone who can talk to the bot — prompt injection would turn it into a shell.

This plugin wraps `math2img` as a first-class OpenClaw tool called
`render_math`. The tool can be allowed or denied independently of `exec`, so
you can safely enable beautiful LaTeX rendering in groups while keeping the
rest of the runtime locked down.

```
┌─────────────┐      ┌─────────────────────┐      ┌───────────┐
│  Agent      │ ───► │  render_math tool   │ ───► │  math2img │
│  (LLM)      │      │  (this plugin)      │      │  binary   │
└─────────────┘      └─────────────────────┘      └───────────┘
      only              parameter-typed,               fixed
    tool call           no shell access              command
```

No `exec`, no shell, no command allowlist to maintain.

## Features

- **One tool, clearly named**: `render_math(latex, theme?, fontSize?, scale?)`
- **Safe by construction**: the plugin spawns `math2img` directly via
  `child_process.spawn` with `shell: false` — no shell metacharacters, no
  argument injection.
- **Channel-agnostic**: returns a list of PNG paths. The agent then sends them
  through whatever `message` channel is active (WhatsApp, Signal, Telegram,
  Matrix, ...).
- **Configurable** via `plugins.entries.render-math.config`:
  - `binary` — path to `math2img` (defaults to
    `~/.openclaw/skills/math-images/scripts/math2img`)
  - `outputDir` — where PNGs are written (defaults to a per-call temp dir)
  - `defaultTheme` — `dark` (default) or `light`
  - `timeoutSeconds` — max runtime for a single render (default 30)

## Prerequisites

1. **OpenClaw** `>= 2026.3.24-beta.2` (plugin API).
2. **`math2img` binary** from
   [juntao/math-images-skill](https://github.com/juntao/math-images-skill).
   Easiest install:

   ```bash
   mkdir -p ~/.openclaw/skills
   git clone https://github.com/juntao/math-images-skill \
       ~/.openclaw/skills/math-images
   ~/.openclaw/skills/math-images/bootstrap.sh
   ```

   This downloads the platform-specific binary to
   `~/.openclaw/skills/math-images/scripts/math2img` — the plugin's default
   path.

## Install

Clone the plugin into your OpenClaw extensions directory and install its
runtime dependencies (there are none besides Node's standard library, but
`npm install` wires the package into the extension loader):

```bash
mkdir -p ~/.openclaw/extensions
cd ~/.openclaw/extensions
git clone https://github.com/sttts/openclaw-render-math.git render-math
cd render-math
npm install --omit=dev   # no-op in most cases; keeps package.json happy
```

Then enable the plugin in `~/.openclaw/openclaw.json`:

```json5
{
  "plugins": {
    "enabled": true,
    "entries": {
      "render-math": {
        "enabled": true,
        "config": {
          "defaultTheme": "dark"
        }
      }
    }
  },
  "skills": {
    "load": {
      "extraDirs": [
        "~/.openclaw/extensions/render-math"
      ]
    }
  }
}
```

Restart the gateway:

```bash
systemctl --user restart openclaw-gateway
# or
sudo systemctl restart openclaw-gateway
```

Verify the tool is registered:

```bash
openclaw doctor
# look for:   Plugins — Loaded: N  (should be +1)
```

## Allow it in group chats

Now you can allow **only** `render_math` in groups that otherwise forbid
runtime tools. Example for WhatsApp:

```json5
{
  "channels": {
    "whatsapp": {
      "groups": {
        "120363...@g.us": {
          "tools": {
            "deny":  ["group:runtime", "group:fs", "web_fetch"],
            "allow": ["render_math", "message"]
          }
        }
      }
    }
  }
}
```

- `exec`, `read`, `write` etc. remain denied.
- `render_math` is the only way the agent can do any host-side work.
- `message` lets the agent send the resulting PNG back to the group.

## Using it

Just ask the agent for math. The model will pick up `render_math` from its
tool list and call it automatically:

> render Attention as a nice formula please

The tool returns something like:

```json
{
  "ok": true,
  "theme": "dark",
  "count": 1,
  "images": [{ "path": "/tmp/openclaw-render-math-X/equation_0001.png", "bytes": 18432 }],
  "hint": "Send each path via the message tool using media:<path>."
}
```

The agent then picks up the `path` and forwards it via the channel's
`message(action: "send", media: ...)` tool.

### Tool schema

```ts
render_math({
  latex: string,          // required, may contain multiple equations
  theme?: "dark" | "light",
  fontSize?: number,      // 8 .. 72, default 24
  scale?:    number,      // 0.5 .. 8, default 3.0
})
```

## Security notes

- **No shell.** `math2img` is invoked with `spawn(binary, [...args], { shell: false })`.
  LaTeX input is written to a file and passed via `-i` — it never touches a
  shell.
- **Bounded runtime.** Default 30 s timeout, `SIGKILL` on overrun.
- **Minimal env.** Only `PATH` is forwarded to the child.
- **No network.** The plugin never performs network I/O of its own.
- **Filesystem.** Reads/writes are limited to a per-call temp directory (or
  `config.outputDir` if you set one). Nothing outside that directory is
  touched.
- **Tool-policy friendly.** `render_math` is `optional: true`, so it only
  appears in the tool list of agents that explicitly allow it.

## Development

```bash
git clone https://github.com/sttts/openclaw-render-math.git
cd openclaw-render-math
# Just edit index.js — no build step, it's plain ESM.
```

Hot-reload is not currently supported; restart the gateway after edits.

## License

MIT
