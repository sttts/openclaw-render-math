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

## Companion skill (optional but recommended)

The plugin only exposes the `render_math` tool — it does not tell the agent
_when_ to use it. For best results, drop the following skill alongside your
other skills so the agent knows to prefer `render_math` over raw LaTeX
replies on channels that can't render math.

Save as `~/.openclaw/skills/math-images/SKILL.md`
(or any directory listed in `skills.load.extraDirs`):

````markdown
---
name: math-equation-images
description: Render LaTeX/TeX math equations as PNG images and send them back through the current channel. Triggered when the user asks for math, formulas, equations, matrices or anything LaTeX-ish to be shown as an image — especially on channels that cannot render math natively (WhatsApp, Signal, SMS, IRC). Supports dark (default) and light themes.
---

# Math Equation Images

Render LaTeX math as PNG images using the **`render_math` tool**.

## Tool

Use the `render_math` tool. Do NOT shell out to `math2img`, `tex`, or any
binary. The tool is the only supported path and works in group chats where
`exec` is denied.

## Parameters

- `latex` (required) — the LaTeX source. Can contain one or more equations in
  `$...$`, `$$...$$` or `\[...\]` form. Plain text around the math is fine;
  only equations are extracted.
- `theme` — `"dark"` (default) or `"light"`. Use `light` if the user asks for
  light mode, white background, bright theme, etc.
- `fontSize` — points, default 24. Only set if the user asks for bigger or
  smaller.
- `scale` — render scale, default 3.0. Only set if the user asks.

## Workflow

1. Call `render_math` with the LaTeX source.
2. The tool returns a JSON result like:

   ```json
   {
     "ok": true,
     "theme": "dark",
     "count": 2,
     "images": [
       { "path": "/tmp/openclaw-render-math-xyz/equation_0001.png", "bytes": 18432 },
       { "path": "/tmp/openclaw-render-math-xyz/equation_0002.png", "bytes": 21004 }
     ]
   }
   ```

3. For **each** image path, call the `message` tool on the current channel:

   - `action: "send"`
   - `channel: <current channel, e.g. "whatsapp">`
   - `target: <current conversation target>`
   - `media: <path from the tool result>`
   - `caption: "Equation 1"`, `"Equation 2"`, ...

   Send them in order.

4. If `ok: false`, tell the user what went wrong (most common: "No math
   equations found in the provided LaTeX" — ask them to wrap the math in
   `$...$` or `$$...$$`).

## When to use

**Always** use this skill when:

- the user asks you to render/show/draw math, a formula, an equation, a
  matrix, a proof, …
- your answer would otherwise contain raw `$...$` or `\[...\]` on a channel
  that can't render math (WhatsApp, Signal, SMS, IRC).

Do NOT reply with raw LaTeX source on those channels — render and send
images instead.
````

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
