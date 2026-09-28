import type { CommandSuggestion } from "../shared/protocol.js";
export function commandWord(text: string, caret: number) {
  const word = /^\/([^\s/]*)/.exec(text)?.[0];
  if (!word || caret < 1 || caret > word.length || text[word.length] === "/") return undefined;
  return word;
}
export function matchingCommands(commands: CommandSuggestion[], word: string) {
  const query = word.slice(1).toLocaleLowerCase();
  return commands.filter(c => `${c.name} ${c.description} ${c.source}`.toLocaleLowerCase().includes(query)).sort((a, b) => Number(!a.name.slice(1).toLocaleLowerCase().startsWith(query)) - Number(!b.name.slice(1).toLocaleLowerCase().startsWith(query)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export function completeCommand(text: string, command: string) {
  const end = text.search(/\s/);
  const tail = end < 0 ? " " : text.slice(end);
  return { text: command + tail, caret: command.length + (tail.startsWith(" ") ? 1 : 0) };
}
