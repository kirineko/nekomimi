import { searchDefaults, type SearchSettings } from "../web-search.js";
import { readFile, lstat, chmod } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { atomicFile } from "../journal.js";
import { directory, userHome } from "../storage/paths.js";
import { ApiError } from "../shared/protocol.js";
export interface Settings {
  version: 1;
  revision: number;
  model: string;
  baseUrl: string;
  search?: SearchSettings;
}
interface Auth {
  version: 1;
  revision: number;
  apiKey?: string;
}
const defaults: Settings = {
  version: 1,
  revision: 0,
  model: "deepseek-flash",
  baseUrl: "https://api.deepseek.com",
};
export class ConfigStore {
  readonly home: string;
  constructor(home?: string) {
    this.home = userHome(home);
  }
  private async read<T>(name: string, fallback: T): Promise<T> {
    try {
      const path = join(this.home, name);
      if ((await lstat(path)).isSymbolicLink()) throw new Error();
      const v = JSON.parse(await readFile(path, "utf8"));
      if (
        v.version !== 1 ||
        !Number.isSafeInteger(v.revision) ||
        v.revision < 0
      )
        throw new Error();
      return v;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      throw new ApiError(422, "config", `${name} 无法读取或版本不受支持`);
    }
  }
  async settings() {
    const v = await this.read("settings.json", defaults);
    this.validate(v);
    return { ...v, search: v.search ?? { ...searchDefaults } };
  }
  private validate(v: Settings) {
    if (v.search !== undefined) {
      if (!v.search || typeof v.search.enabled !== "boolean") throw new ApiError(400, "config", "搜索配置无效");
      this.validate({ version: 1, revision: 0, model: v.search.model, baseUrl: v.search.baseUrl });
    }
    if (
      typeof v.model !== "string" ||
      !v.model.trim() ||
      v.model.length > 100 ||
      typeof v.baseUrl !== "string"
    )
      throw new ApiError(400, "config", "模型或服务地址无效");
    try {
      const u = new URL(v.baseUrl);
      if (
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        !(
          u.protocol === "https:" ||
          (u.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
        )
      )
        throw new Error();
    } catch {
      throw new ApiError(
        400,
        "config",
        "服务地址须为 HTTPS 或本机 HTTP，不得含凭证或查询参数",
      );
    }
  }
  private async auth() {
    const a = await this.read<Auth>("auth.json", { version: 1, revision: 0 });
    if (
      a.apiKey !== undefined &&
      (typeof a.apiKey !== "string" ||
        !a.apiKey.trim() ||
        a.apiKey.length > 4096)
    )
      throw new ApiError(422, "config", "凭证文件无效");
    return a;
  }
  async snapshot() {
    const [s, a] = await Promise.all([this.settings(), this.auth()]);
    return { ...s, apiKey: a.apiKey };
  }
  async describe() {
    const [s, a] = await Promise.all([this.settings(), this.auth()]);
    return { ...s, authRevision: a.revision, configured: !!a.apiKey };
  }
  async save(kind: "settings" | "auth", value: Record<string, unknown>) {
    const home = await directory(this.home);
    const release = await lockfile.lock(home, {
      retries: { retries: 10, minTimeout: 20, maxTimeout: 100 },
    });
    try {
      const old =
        kind === "settings" ? await this.settings() : await this.auth();
      if (value.revision !== old.revision)
        throw new ApiError(409, "config_conflict", "配置已更新，请重新加载");
      let next: Settings | Auth;
      if (kind === "settings") {
        next = {
          version: 1,
          revision: old.revision + 1,
          model: value.model as string,
          baseUrl: value.baseUrl as string,
          search: value.search as SearchSettings ?? (old as Settings).search ?? { ...searchDefaults },
        };
        this.validate(next);
      } else {
        if (
          value.apiKey !== null &&
          (typeof value.apiKey !== "string" ||
            !value.apiKey.trim() ||
            value.apiKey.length > 4096 ||
            /[\r\n]/.test(value.apiKey))
        )
          throw new ApiError(
            400,
            "config",
            "请输入有效 API key，清除请使用清除操作",
          );
        next = {
          version: 1,
          revision: old.revision + 1,
          ...(value.apiKey === null
            ? {}
            : { apiKey: (value.apiKey as string).trim() }),
        };
      }
      const path = join(home, `${kind}.json`);
      await atomicFile(path, JSON.stringify(next, null, 2));
      await chmod(path, 0o600);
      return this.describe();
    } finally {
      await release();
    }
  }
}
