import { readFile } from "node:fs/promises";
import { hash, type JournalEvent } from "../journal.js";
import { ApiError, object, type DeliverySelection, type DeliverySnapshot, type DeliveryEvidence, type SessionBinding } from "../shared/protocol.js";
import type { CustomizationHost } from "../customization/host.js";
import { Candidates } from "../customization/candidates.js";
import { SDK_VERSION } from "../customization/types.js";
import { safePath, type Resource } from "../customization/resources.js";
import type { LifecycleEvidence } from "../shared/customization-lifecycle.js";
import { commandTargets } from "../customization/commands.js";
import { currentTargetHost, checkSessionTarget } from "./identity.js";

export function parseDeliverySelections(value: unknown): DeliverySelection[] {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw new ApiError(400, "delivery_selection", "请选择 1 至 8 项具体交付版本");
  const seen = new Set<string>();
  return value.map(input => {
    const item = object(input);
    if (Object.keys(item).some(key => !["resourceId", "revision", "candidateId", "type", "localId", "usage"].includes(key)) ||
        typeof item.resourceId !== "string" || item.resourceId.length > 160 || typeof item.revision !== "string" || !/^[a-f0-9]{64}$/.test(item.revision) ||
        (item.candidateId !== undefined && (typeof item.candidateId !== "string" || !/^[a-z0-9-]{1,100}$/.test(item.candidateId))) ||
        (item.type !== undefined && (typeof item.type !== "string" || !/^[a-z-]{1,48}$/.test(item.type))) ||
        (item.localId !== undefined && (typeof item.localId !== "string" || item.localId.length > 100)) ||
        typeof item.usage !== "string" || !item.usage.trim() || Buffer.byteLength(item.usage) > 8192)
      throw new ApiError(400, "delivery_selection", "交付选择无效，验证阶段和权限不能由客户端提供");
    const key = JSON.stringify([item.resourceId, item.candidateId, item.type, item.localId]);
    if (seen.has(key)) throw new ApiError(400, "delivery_selection", "交付选择重复");
    seen.add(key); return { resourceId: item.resourceId, revision: item.revision, usage: item.usage.trim(),
      ...(item.candidateId ? { candidateId: item.candidateId as string } : {}), ...(item.type ? { type: item.type as string } : {}), ...(item.localId ? { localId: item.localId as string } : {}) };
  });
}
/** File digests compare identical bytes across development and installation-specific resource IDs. */
export function deliveryContentHash(resource: Resource) {
  const files = { ...Object.fromEntries(Object.entries(resource.files ?? {}).map(([path, text]) => [path, hash(text)])),
    ...resource.fileHashes, ...Object.fromEntries(Object.entries(resource.binaryFiles ?? {}).map(([path, bytes]) => [path, hash(bytes)])) };
  return hash(JSON.stringify(Object.keys(files).length ? Object.entries(files).sort(([a], [b]) => a.localeCompare(b)) : [[resource.kind, hash(resource.text)]]));
}
async function selectedResource(host: CustomizationHost, selection: Pick<DeliverySelection, "resourceId" | "revision" | "candidateId">) {
  let resource: Resource | undefined;
  try { resource = selection.candidateId ? await new Candidates(host.catalog.workspace).read(selection.candidateId) : (await host.catalog.discover()).find(resource => resource.id === selection.resourceId); }
  catch { throw new ApiError(409, "delivery_unavailable", "所选交付版本已删除或不可读，原证据不会恢复旧候选"); }
  if (!resource || resource.scope === "builtin" || resource.error || resource.id !== selection.resourceId || resource.hash !== selection.revision)
    throw new ApiError(409, "delivery_changed", "所选交付版本缺失或已变化，请重新检查版本");
  return resource;
}
function evidence(records: JournalEvent[], resource: Resource, host: string, origin: DeliveryEvidence["origin"], localId?: string): DeliveryEvidence[] {
  return records.filter(event => {
    const value = event.payload as LifecycleEvidence;
    return value.resourceId === resource.id && value.revision === resource.hash && value.host === host &&
      value.environment?.node === process.version && value.environment.platform === process.platform && value.environment.arch === process.arch && value.environment.sdkVersion === SDK_VERSION &&
      (!value.contributionId || !localId || value.contributionId === localId) && ["static", "simulation", "preview", "host", "loaded", "load-failed"].includes(value.stage);
  }).slice(-32).map(event => {
    const value = event.payload as LifecycleEvidence;
    return { origin, eventId: event.eventId, seq: event.seq, hash: event.hash, stage: value.stage, revision: value.revision, host: value.host, at: value.at,
      ...(value.passed === undefined ? {} : { passed: value.passed }), status: value.status, check: value.check, environment: structuredClone(value.environment), verification: structuredClone(value.verification) };
  });
}
/** Mirrors theme precedence while keeping observation free of directory creation. */
async function themeSelection(host: CustomizationHost) {
  const preference = async (scope: "project" | "user") => {
    try {
      const path = await safePath(scope === "project" ? host.catalog.workspace : host.catalog.home, scope === "project" ? ".nekomimi/ui-theme.json" : "ui-theme.json");
      const value = JSON.parse(await readFile(path, "utf8"));
      if (value.version !== 1 || !Number.isSafeInteger(value.revision)) throw new Error("Invalid theme preference");
      return value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
  };
  const [project, user] = await Promise.all([preference("project"), preference("user")]);
  return project.selection !== undefined ? project.selection : user.selection;
}
function workEntries(host: CustomizationHost, resource: Resource, type: string, localId?: string) {
  const commands = host.commands("work").commands.filter(command => command.id === resource.id || command.id.startsWith(resource.id + ":"));
  if (type === "commands") return commands.filter(command => command.kind === "extension" && (!localId || command.id === `${resource.id}:command:${localId}`)).map(command => command.name);
  if (type === "workflows") {
    const targets = host.active ? commandTargets(host.active, "work").filter(target => target.ext.resource.id === resource.id && target.workflow && (!localId || target.workflow.id === localId)) : [];
    return commands.filter(command => command.kind === "workflow" && targets.some(target => command.id === `${resource.id}:workflow:${target.name}`)).map(command => command.name);
  }
  return commands.map(command => command.name);
}
/** No acquire/reload, compiler, preview execution, model call, permission write or theme selection. */
export async function buildDeliverySnapshots(options: { source: SessionBinding; target: SessionBinding; development: CustomizationHost; work: CustomizationHost; selections: unknown }): Promise<DeliverySnapshot[]> {
  if (options.source.mode !== "create" || options.target.mode !== "work" || options.source.ownerWorkspace !== options.target.ownerWorkspace ||
      options.development.catalog.workspace !== options.source.target.root || options.work.catalog.workspace !== options.target.target.root)
    throw new ApiError(403, "delivery_scope", "交付需要绑定的创造来源与同项目工作目标");
  await checkSessionTarget(options.source, options.development.catalog.home); await checkSessionTarget(options.target, options.work.catalog.home);
  const selections = parseDeliverySelections(options.selections), host = await currentTargetHost();
  const [developmentRecords, workRecords, workResources] = await Promise.all([options.development.lifecycle.records(), options.work.lifecycle.records(), options.work.catalog.discover()]);
  const snapshots: DeliverySnapshot[] = [];
  for (const selection of selections) {
    const resource = await selectedResource(options.development, selection), contentHash = deliveryContentHash(resource);
    const candidateOrigin = selection.candidateId ? await new Candidates(options.development.catalog.workspace).origin(selection.candidateId) : undefined;
    const sourceRecord = developmentRecords.map(event => event.payload as LifecycleEvidence).find(value => value.resourceId === resource.id && value.sourceBinding && value.stage === "created");
    const creator = candidateOrigin?.session ?? sourceRecord?.sourceBinding;
    const creation = creator ? { sessionId: creator.sessionId, runId: candidateOrigin ? candidateOrigin.runId : sourceRecord?.runId, ownerWorkspace: creator.ownerWorkspace, target: creator.target, scope: resource.scope as "project" | "user" } : undefined;
    const type = selection.type ?? resource.kind;
    if (type !== resource.kind && !resource.manifest?.requiredCapabilities?.includes(type as any)) throw new ApiError(400, "delivery_type", "所选贡献类型不属于该资源");
    const matching = (item: Resource) => item.kind === resource.kind && item.name === resource.name && item.scope === resource.scope;
    const workResource = workResources.find(item => matching(item) && item.status !== "shadowed");
    const active = options.work.active?.resources.find(item => matching(item) && item.status === "enabled");
    const developmentActive = options.development.active?.resources.find(item => item.id === resource.id && item.status === "enabled");
    const grant = workResource ? await options.work.catalog.grant(workResource) : undefined;
    const required = resource.manifest?.requiredCapabilities ?? [];
    const missing = required.filter(capability => !grant?.enabled || !grant.trusted || !grant.capabilities?.includes(capability));
    const ext = options.work.active?.extensions.find(ext => ext.resource.id === active?.id);
    const granted = !resource.manifest || !!grant?.enabled && !!grant.trusted && missing.length === 0;
    const available = !!active && workResource?.status === "enabled" && !ext?.unavailable?.() && deliveryContentHash(active) === contentHash && granted;
    const entries = active && available ? workEntries(options.work, active, type, selection.localId) : [];
    let applied = false;
    if (type === "themes" && available) {
      const selected = await themeSelection(options.work);
      applied = !!selected && selected.resourceId === active!.id && selected.revision === active!.hash &&
        (!selection.localId || selected.id === selection.localId) && !!ext?.themes?.some(theme => theme.id === selected.id);
    }
    const phase: DeliverySnapshot["phase"] = !workResource ? "awaiting-delivery" : missing.length || !granted ? "authorization" : !available || ["commands", "workflows"].includes(type) && !entries.length ? "unavailable" : type === "themes" ? applied ? "applied" : "awaiting-application" : "available";
    snapshots.push({ version: 1, ...(creation ? {creation} : {}), resourceId: resource.id, revision: resource.hash, contentHash,
      ...(selection.candidateId ? { candidateId: selection.candidateId, candidateRevision: resource.hash } : {}), name: resource.name, kind: resource.kind, type,
      ...(selection.localId ? { localId: selection.localId } : {}), scope: resource.scope as "project" | "user", usage: selection.usage,
      developmentTargetId: options.source.target.id, workTargetId: options.target.target.id, host,
      ...(developmentActive ? { developmentActiveRevision: developmentActive.hash } : {}), ...(workResource ? { workResourceId: workResource.id } : {}),
      ...(active ? { workActiveRevision: active.hash } : {}), phase, entries, missing,
      evidence: [...evidence(developmentRecords, resource, host.build, "development", selection.localId), ...(workResource ? evidence(workRecords, workResource, host.build, "work", selection.localId) : [])],
      required: [...required], applied, executesCommand: false, grantsPermissions: false });
  }
  return snapshots;
}
export async function validateDeliveryVersions(host: CustomizationHost, snapshots: DeliverySnapshot[]) {
  const current = await currentTargetHost();
  for (const snapshot of snapshots) {
    if (JSON.stringify(current) !== JSON.stringify(snapshot.host)) throw new ApiError(409, "delivery_host", "交付宿主构建已变化");
    const resource = await selectedResource(host, snapshot);
    if (deliveryContentHash(resource) !== snapshot.contentHash) throw new ApiError(409, "delivery_changed", "交付内容摘要已变化");
  }
}
/** Current work facts remain inspectable when the development session has been deleted. */
export async function inspectWorkDelivery(host: CustomizationHost, snapshot: DeliverySnapshot) {
  const resources = await host.catalog.discover();
  const matching = (item: Resource) => item.kind === snapshot.kind && item.name === snapshot.name && item.scope === snapshot.scope;
  const resource = resources.find(item => matching(item) && item.status !== "shadowed"), active = host.active?.resources.find(item => matching(item) && item.status === "enabled");
  const grant = resource ? await host.catalog.grant(resource) : undefined;
  const required = [...new Set([...(snapshot.required ?? []), ...(resource?.manifest?.requiredCapabilities ?? [])])];
  const missing = required.filter(capability => !grant?.enabled || !grant.trusted || !grant.capabilities?.includes(capability as any));
  const ext = host.active?.extensions.find(ext => ext.resource.id === active?.id);
  const available = !!active && resource?.status === "enabled" && !ext?.unavailable?.() && deliveryContentHash(active) === snapshot.contentHash &&
    (!resource?.manifest || !!grant?.enabled && !!grant.trusted && !missing.length);
  const entries = active && available ? workEntries(host, active, snapshot.type, snapshot.localId) : [];
  let applied = false;
  if (snapshot.type === "themes" && available) {
    const selected = await themeSelection(host);
    applied = !!selected && selected.resourceId === active!.id && selected.revision === active!.hash && (!snapshot.localId || selected.id === snapshot.localId) && !!ext?.themes?.some(theme => theme.id === selected.id);
  }
  const phase = !resource ? "awaiting-delivery" : missing.length || !!resource.manifest && (!grant?.enabled || !grant.trusted) ? "authorization" : !available || ["commands", "workflows"].includes(snapshot.type) && !entries.length ? "unavailable" : snapshot.type === "themes" ? applied ? "applied" : "awaiting-application" : "available";
  return { phase, entries, missing, applied, workResourceId: resource?.id, workActiveRevision: active?.hash,
    currentContentHash: resource ? deliveryContentHash(resource) : undefined, matchesDeliveredContent: !!active && deliveryContentHash(active) === snapshot.contentHash,
    filesDifferFromActive: !!resource && !!active && deliveryContentHash(resource) !== deliveryContentHash(active),
    executesCommand: false, grantsPermissions: false };
}
