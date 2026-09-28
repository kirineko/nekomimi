import type { Activation, LoadedExtension } from "./host.js";
import type { ExtensionCommand } from "./types.js";
import type { RegisteredWorkflow } from "./workflow-contract.js";
import type { CommandCatalog, CommandSuggestion } from "../shared/protocol.js";
import { hash } from "../journal.js";

type Target = { ext: LoadedExtension; name: string; cmd?: ExtensionCommand; workflow?: RegisteredWorkflow };
export function commandTargets(activation: Activation): Target[] {
  return activation.extensions.flatMap(ext => [
    ...[...ext.commands].map(([name, cmd]) => ({ ext, name, cmd })),
    ...ext.workflows.flatMap(workflow => [...new Set((workflow.triggers ?? []).filter(t => t.kind === "command").map(t => t.name ?? workflow.id))].map(name => ({ ext, name, workflow }))),
  ]);
}
export function matchCommands(activation: Activation, name: string) {
  const matching = commandTargets(activation).filter(t => name === t.name || name === `${t.ext.resource.name}:${t.name}`);
  return {
    candidates: matching.filter((t): t is Target & { cmd: ExtensionCommand } => !!t.cmd),
    workflows: [...new Set(matching.flatMap(t => t.workflow ? [t.workflow] : []))],
  };
}
export function matchSkills(activation: Activation, name: string) {
  return activation.resources.filter(r => r.kind === "skill" && r.status === "enabled" && (r.name === name || r.id === name));
}
export function commandCatalog(activation?: Activation): CommandCatalog {
  if (!activation) return { revision: "unavailable", ready: false, commands: [] };
  const commands: CommandSuggestion[] = [{ id: "builtin:reload", kind: "builtin", name: "/reload", description: "重新加载定制资源", source: "Nekomimi", insertText: "/reload" }];
  const unique = (name: string, target: Target) => {
    if (name === "reload" || name.startsWith("skill:")) return false;
    const matches = matchCommands(activation, name);
    return target.cmd ? matches.candidates.length === 1 && !matches.workflows.length && matches.candidates[0]?.cmd === target.cmd
      : !matches.candidates.length && matches.workflows.length === 1 && matches.workflows[0] === target.workflow;
  };
  for (const target of commandTargets(activation)) {
    if (target.ext.unavailable?.()) continue;
    const qualified = `${target.ext.resource.name}:${target.name}`;
    const name = unique(target.name, target) ? target.name : unique(qualified, target) ? qualified : undefined;
    if (!name) continue;
    commands.push({
      id: `${target.ext.resource.id}:${target.cmd ? "command" : "workflow"}:${target.name}`,
      kind: target.cmd ? "extension" : "workflow", name: `/${name}`, insertText: `/${name}`,
      description: target.cmd?.description || (target.workflow ? "启动工作流（参数为 JSON）" : "扩展命令"), source: target.ext.resource.name,
    });
  }
  for (const resource of activation.resources.filter(r => r.kind === "skill" && r.status === "enabled")) {
    const name = matchSkills(activation, resource.name).length === 1 ? resource.name : resource.id;
    if (matchSkills(activation, name).length !== 1) continue;
    commands.push({ id: resource.id, kind: "skill", name: `/skill:${name}`, insertText: `/skill:${name}`, description: resource.description || "加载技能并执行任务", source: resource.name });
  }
  commands.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { revision: hash(JSON.stringify([activation.revision, commands])), ready: true, commands };
}
