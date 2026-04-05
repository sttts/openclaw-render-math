// We intentionally do NOT import `definePluginEntry` from the openclaw
// package — that would require the plugin to have openclaw as a dependency
// in its own node_modules, which is not the case when installed via a bare
// `git clone`. `definePluginEntry` is just an identity function for type
// hints, so we can export the same shape directly as the default export
// and the OpenClaw plugin loader picks it up.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";

// Defaults that work on claudie's VM out of the box.
const DEFAULT_BINARY = path.join(
  homedir(),
  ".openclaw",
  "skills",
  "math-images",
  "scripts",
  "math2img",
);
const DEFAULT_THEME = "dark";
const DEFAULT_TIMEOUT_MS = 30_000;

// JSON schema for the tool parameters. OpenClaw uses this for function calling.
const parametersSchema = {
  type: "object",
  additionalProperties: false,
  required: ["latex"],
  properties: {
    latex: {
      type: "string",
      minLength: 1,
      description:
        "The LaTeX source to render. Can contain one or more math expressions in $...$, $$...$$ or \\[...\\] form. Plain text around the math is fine — only equations are extracted.",
    },
    theme: {
      type: "string",
      enum: ["dark", "light"],
      description: "Color theme. Defaults to dark.",
    },
    fontSize: {
      type: "number",
      minimum: 8,
      maximum: 72,
      description: "Font size in points. Default 24.",
    },
    scale: {
      type: "number",
      minimum: 0.5,
      maximum: 8,
      description: "Render scale factor. Default 3.0.",
    },
  },
};

function runMath2img({ binary, inputFile, outputDir, theme, fontSize, scale, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const args = ["-i", inputFile, "-o", outputDir, "--theme", theme];
    if (fontSize != null) args.push("--font-size", String(fontSize));
    if (scale != null) args.push("--scale", String(scale));

    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      // No shell, no env leakage.
      shell: false,
      env: { PATH: process.env.PATH ?? "" },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`math2img timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `math2img exited with code ${code}: ${stderr.trim() || stdout.trim() || "(no output)"}`,
          ),
        );
      }
    });
  });
}

async function listPngs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const pngs = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
      const full = path.join(dir, entry.name);
      const info = await stat(full);
      pngs.push({ path: full, size: info.size, name: entry.name });
    }
  }
  pngs.sort((a, b) => a.name.localeCompare(b.name));
  return pngs;
}

export default {
  id: "render-math",
  name: "Render Math",
  description: "Renders LaTeX math equations to PNG images without granting exec permission.",
  register(api) {
    api.registerTool(
      (_ctx) => ({
        name: "render_math",
        label: "Render Math Equations",
        description:
          "Render LaTeX math equations as PNG images. Use this whenever the user asks for math, formulas, matrices or equations to be shown as an image. Returns a list of file paths that can be sent via the message tool. Prefer this over replying with raw LaTeX source when the channel cannot render math (WhatsApp, Signal, SMS).",
        parameters: parametersSchema,
        async execute(_toolCallId, rawParams) {
          const config = api.getConfig?.() ?? {};
          const binary = config.binary || DEFAULT_BINARY;
          const theme = rawParams.theme || config.defaultTheme || DEFAULT_THEME;
          const fontSize = rawParams.fontSize;
          const scale = rawParams.scale;
          const timeoutMs = (config.timeoutSeconds ?? DEFAULT_TIMEOUT_MS / 1000) * 1000;

          // Put inputs/outputs in a throwaway dir so concurrent calls don't clash.
          const baseDir =
            config.outputDir ||
            (await mkdtemp(path.join(tmpdir(), "openclaw-render-math-")));
          await mkdir(baseDir, { recursive: true });

          const inputFile = path.join(baseDir, "input.tex");
          await writeFile(inputFile, rawParams.latex, "utf8");

          try {
            await runMath2img({
              binary,
              inputFile,
              outputDir: baseDir,
              theme,
              fontSize,
              scale,
              timeoutMs,
            });
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: false,
                      error: err instanceof Error ? err.message : String(err),
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          const pngs = await listPngs(baseDir);
          if (pngs.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: false,
                      error: "No math equations found in the provided LaTeX.",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: true,
                    theme,
                    count: pngs.length,
                    images: pngs.map((p) => ({ path: p.path, bytes: p.size })),
                    hint: "Send each path via the message tool using media:<path>.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        },
      }),
      { name: "render_math", optional: true },
    );
  },
};
