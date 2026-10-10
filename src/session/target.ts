import { readFile, stat, realpath } from "node:fs/promises";
import { dirname, relative, isAbsolute, resolve, join } from "node:path";
import { homedir } from "node:os";
import { userHome } from "../storage/paths.js";
import { hostIdentity } from "../customization/sdk.js";
import { safePath } from "../customization/resources.js";
import { hash } from "../journal.js";
import { ApiError, type SessionTarget } from "../shared/protocol.js";
import { DATA_FORMAT_VERSION, SDK_CONTRACT_VERSION } from "../shared/versions.js";

function within(root: string, path: string) {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel));
}
/** Read-only admission; never installs dependencies, downloads source or runs build scripts. */
async function canonicalRoot(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error;
    return resolve(await canonicalRoot(dirname(path)), relative(dirname(path), path));
  }
}
export async function checkDevelopmentTarget(target: SessionTarget, ownerWorkspace: string, home?: string) {
  const host = await hostIdentity();
  const expected = { id: hash(host.entry), build: host.build, sdkVersion: SDK_CONTRACT_VERSION, dataFormatVersion: DATA_FORMAT_VERSION };
  if (!target.host || JSON.stringify(target.host) !== JSON.stringify(expected))
    throw new ApiError(409, "host_changed", "创造目标宿主或 SDK 构建已变化，请明确建立新目标会话");
  const installation = await realpath(dirname(dirname(host.entry)));
  if (within(target.root, ownerWorkspace) || within(target.root, installation) || within(installation, target.root))
    throw new ApiError(403, "target_scope", "创造目录不能包含用户项目，也不能覆盖或位于当前宿主安装目录中");
  const protectedRoots = [await canonicalRoot(userHome(home)), await canonicalRoot(join(homedir(), ".nekomimi")), await canonicalRoot(join(homedir(), ".agents/skills"))];
  if (protectedRoots.some(root => within(target.root, root) || within(root, target.root)))
    throw new ApiError(403, "target_scope", "创造开发目录不能覆盖用户资源或宿主数据目录；用户资源需通过独立授权入口写入");
  if (target.kind !== "core") return;
  try {
    const json = async (name: string) => {
      const file = await safePath(target.root, name), info = await stat(file);
      if (!info.isFile() || info.size > 1024 * 1024) throw new Error("Source prerequisite size limit");
      return JSON.parse(await readFile(file, "utf8"));
    };
    const pkg = await json("package.json"), lock = await json("package-lock.json");
    if (pkg.name !== "nekomimi" || pkg.version !== host.version || lock.packages?.[""]?.name !== pkg.name ||
        lock.packages?.[""]?.version !== pkg.version || typeof pkg.scripts?.build !== "string" || !pkg.scripts.build.trim())
      throw new Error("Source version or build entry mismatch");
    for (const file of ["src/cli.ts", "tsconfig.build.json"])
      if (!(await stat(await safePath(target.root, file))).isFile()) throw new Error("Source entry missing");
  } catch {
    throw new ApiError(422, "core_source", "核心目标缺少匹配版本的 Nekomimi 源码、依赖锁或构建入口；请提供独立源码候选，不会自动下载或修改安装");
  }
  const { CoreCandidates } = await import('../core/candidates.js');
  const candidates = new CoreCandidates(ownerWorkspace, home);
  const candidate = (await candidates.list()).find(item => item.directory === target.root);
  if (!candidate) throw new ApiError(422, 'core_candidate', '核心目标未登记源码候选；请先显式预览并准备独立源码副本');
  const inspected = await candidates.inspect(candidate.id);
  if (!inspected.hostMatches || target.coreCandidate && (target.coreCandidate.id !== candidate.id || target.coreCandidate.sourceRevision !== candidate.source.revision))
    throw new ApiError(409, 'core_candidate', '核心候选基线或目标宿主不匹配');
  return { id: candidate.id, sourceRevision: candidate.source.revision };
}
