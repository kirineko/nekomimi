import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { ConfigStore } from "./store.js";
export async function configure(store: ConfigStore) {
  if (!process.stdin.isTTY)
    throw new Error("请在交互终端运行 nekomimi config，或使用 Web 设置");
  let hidden = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!hidden) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const current = await store.describe();
    const model =
      (await rl.question(`模型 [${current.model}]: `)).trim() || current.model;
    const baseUrl =
      (await rl.question(`服务地址 [${current.baseUrl}]: `)).trim() ||
      current.baseUrl;
    const answer = (await rl.question(`自动压缩上下文 [${current.autoCompact ? "Y/n" : "y/N"}]: `)).trim().toLowerCase();
    if (answer && !["y", "n", "yes", "no"].includes(answer)) throw new Error("请输入 y 或 n");
    await store.save("settings", {
      autoCompact: answer ? ["y", "yes"].includes(answer) : current.autoCompact,
      revision: current.revision,
      model,
      baseUrl,
    });
    process.stdout.write("API key（留空保留，输入 CLEAR 清除）: ");
    hidden = true;
    const key = (await rl.question("")).trim();
    hidden = false;
    process.stdout.write("\n");
    if (key)
      await store.save("auth", {
        revision: current.authRevision,
        apiKey: key === "CLEAR" ? null : key,
      });
    console.log("配置已保存");
  } finally {
    hidden = false;
    rl.close();
  }
}
