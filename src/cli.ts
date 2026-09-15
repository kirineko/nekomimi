#!/usr/bin/env node
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { run } from "./runtime.js";
import { readSession, id } from "./journal.js";
import { exportSession, inspectBundle, importBundle } from "./export.js";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      help: { type: "boolean", short: "h" },
      json: { type: "boolean" },
      workspace: { type: "string" },
      session: { type: "string" },
      model: { type: "string" },
      "base-url": { type: "string" },
      "max-output-tokens": { type: "string" },
      "max-turns": { type: "string" },
      output: { type: "string", short: "o" },
      format: { type: "string" },
      redact: { type: "string", multiple: true },
      instructions: { type: "string", multiple: true },
      tools: { type: "string" },
      image: { type: "string", multiple: true },
    },
  });
  const [command, arg, ...rest] = positionals;
  if (values.help || !command) {
    console.log(
      `Harness — inspectable local coding agent\n\nharness web [--workspace <dir>] [--port <port>]\n\nharness run <prompt> [--workspace <dir>] [--session <dir>] [--json]\nharness resume <session> <prompt> [--json]\nharness replay <session>\nharness export <session> --format html|bundle --output <path> [--redact <text>]\nharness inspect <bundle>\nharness import <bundle> --output <new-session-dir>\n\nOptions: --model, --base-url, --max-output-tokens, --max-turns, --instructions <file>, --tools <comma-list>, --image <file>\nCredentials: DEEPSEEK_API_KEY; default model: deepseek-flash.\nShell executes locally with your OS permissions; only file tools enforce workspace boundaries.\nFull bundles contain task content; HTML is a redacted offline reading view.`,
    );
    return;
  }
  if (command === "web") {
    const { startWeb } = await import("./server/app.js");
    const port = values.port === undefined ? 0 : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("Invalid port");
    const app = await startWeb({
      workspace: resolve(values.workspace ?? process.cwd()),
      port,
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: values.model,
      baseUrl: values["base-url"],
    });
    console.log(`Web: ${app.url}`);
    let stopping = false;
    const stop = () => {
      if (!stopping) {
        stopping = true;
        void app.close().catch((e) => {
          console.error(String(e));
          process.exitCode = 1;
        });
      }
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return;
  }
  if (!arg) throw new Error("Missing prompt or session path");
  if (command === "replay") {
    console.log(JSON.stringify(await readSession(arg), null, 2));
    return;
  }
  if (command === "inspect") {
    console.log(JSON.stringify(await inspectBundle(arg), null, 2));
    return;
  }
  if (command === "import") {
    if (!values.output) throw new Error("--output is required");
    console.log(await importBundle(arg, values.output));
    return;
  }
  if (command === "export") {
    if (!values.output || !["html", "bundle"].includes(values.format ?? ""))
      throw new Error("--format html|bundle and --output are required");
    console.log(
      await exportSession(arg, {
        output: values.output,
        format: values.format as "html" | "bundle",
        redact: values.redact,
      }),
    );
    return;
  }
  if (command !== "run" && command !== "resume")
    throw new Error("Unknown command");
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required to run a model");
  const session =
    command === "resume"
      ? resolve(arg)
      : resolve(
          values.session ?? join(homedir(), ".deepy-harness", "sessions", id()),
        );
  const prior =
    command === "resume"
      ? ((await readSession(session)).events.find(
          (e) => e.type === "session.created",
        )?.payload as
          | { workspace: string; model: string; baseUrl: string }
          | undefined)
      : undefined;
  const prompt =
    command === "resume" ? rest.join(" ") : [arg, ...rest].join(" ");
  const instructions = await Promise.all(
    (values.instructions ?? []).map(async (path) => ({
      source: resolve(path),
      text: await readFile(path, "utf8"),
    })),
  );
  const images = await Promise.all(
    (values.image ?? []).map(async (path) => {
      const extension = path.split(".").at(-1)?.toLowerCase();
      const mimeType = (
        {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
        } as Record<string, string>
      )[extension ?? ""];
      if (!mimeType) throw new Error("Unsupported image format");
      return {
        type: "image" as const,
        data: (await readFile(path)).toString("base64"),
        mimeType,
      };
    }),
  );
  const positive = (value: string | undefined, fallback: number) => {
    const n = Number(value ?? fallback);
    if (!Number.isInteger(n) || n < 1)
      throw new Error("Limits must be positive integers");
    return n;
  };
  const abort = new AbortController();
  const onInterrupt = () => abort.abort(new Error("User cancelled"));
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  try {
    if (!values.json) console.error(`Session: ${session}`);
    const result = await run({
      session,
      workspace: resolve(values.workspace ?? prior?.workspace ?? process.cwd()),
      prompt,
      apiKey,
      model: values.model ?? prior?.model,
      baseUrl: values["base-url"] ?? prior?.baseUrl,
      maxOutputTokens: positive(values["max-output-tokens"], 4096),
      maxTurns: positive(values["max-turns"], 32),
      instructions,
      images,
      tools: values.tools?.split(",").filter(Boolean),
      signal: abort.signal,
    });
    console.log(
      values.json
        ? JSON.stringify(result)
        : `${result.text || result.error || result.status}\n[${result.status}; durable sequence ${result.durableSeq}]`,
    );
    process.exitCode =
      result.status === "completed"
        ? 0
        : result.status === "cancelled"
          ? 130
          : 1;
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
  }
}
main().catch((error) => {
  console.error(String(error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
