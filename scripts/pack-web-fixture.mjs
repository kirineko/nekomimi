// Copied into a clean tarball installation by pack-smoke.mjs.
import { startWeb } from "deepy-harness";
const item = {
  type: "message",
  id: "m",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text: "pack web ready", annotations: [] }],
};
const events = [
  { type: "response.created", response: { id: "r", status: "in_progress" } },
  {
    type: "response.output_item.added",
    output_index: 0,
    item: { ...item, content: [] },
  },
  {
    type: "response.content_part.added",
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "", annotations: [] },
  },
  {
    type: "response.output_text.delta",
    output_index: 0,
    content_index: 0,
    delta: "pack web ready",
  },
  { type: "response.output_item.done", output_index: 0, item },
  {
    type: "response.completed",
    response: {
      id: "r",
      status: "completed",
      output: [item],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  },
];
const app = await startWeb({
  workspace: process.cwd(),
  apiKey: "synthetic",
  runtime: {
    fetch: async () =>
      new Response(
        events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
        { headers: { "content-type": "text/event-stream" } },
      ),
  },
});
const request = async (path, body) => {
  const result = await fetch(app.origin + "/api/v1" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${app.token}`,
      origin: app.origin,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!result.ok) throw new Error(await result.text());
  return result;
};
try {
  const html = await (await fetch(app.origin)).text();
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  if (!(await fetch(app.origin + asset)).ok)
    throw new Error("Missing built JS");
  const session = await (
    await request("/sessions", { version: 1, title: "Pack fixture" })
  ).json();
  await request(`/sessions/${session.id}/submit`, {
    version: 1,
    commandId: "pack",
    prompt: "hi",
  });
  await app.sessions.active?.done;
  const snapshot = await (
    await request(`/sessions/${session.id}/snapshot`)
  ).json();
  if (snapshot.session.status !== "completed")
    throw new Error("Installed web run failed");
  const download = await request(`/sessions/${session.id}/export`, {
    version: 1,
    format: "html",
    redact: [],
  });
  if (!(await download.text()).includes("pack web ready"))
    throw new Error("Installed web export failed");
  console.log("web-static-command-export: passed");
} finally {
  await app.close();
}
