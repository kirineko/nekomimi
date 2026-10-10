import { Value } from "typebox/value";
import { hash, readArtifact, type Journal, type Artifact } from "../journal.js";
import type { McpConnection } from "./mcp.js";
import type { Resource } from "./resources.js";

/** Display names are not routing keys. Identity remains stable across discovery order. */
export function mcpToolName(resource: Pick<Resource, "id" | "name">, name: string) {
  const label = resource.name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20);
  return `mcp_${label}_${hash(JSON.stringify([resource.id, name])).slice(0, 32)}`;
}
interface DiscoverySnapshot {
  server: string; resourceRevision: string; serverVersion?: unknown; revision: string;
  tools: Array<{id:string;name:string;description?:string;inputSchema:object}>;
}
export class McpDiscovery {
  private readonly snapshots = new Map<string, DiscoverySnapshot>();
  private readonly restored = new Set<string>();
  constructor(private readonly connections: readonly McpConnection[], private readonly authorize: (server: string) => Promise<void>, private readonly journal?: Journal) {}
  private capture(connection:McpConnection):DiscoverySnapshot {
    const tools=connection.tools.map(tool=>({id:mcpToolName(connection.resource,tool.name),name:tool.name,description:tool.description,inputSchema:structuredClone(tool.inputSchema)}));
    if(new Set(tools.map(tool=>tool.id)).size!==tools.length)throw new Error('MCP tool identity collision');
    const body={server:connection.resource.id,resourceRevision:connection.resource.hash,serverVersion:structuredClone(connection.serverInfo),tools};
    return {...body,revision:hash(JSON.stringify(body))};
  }
  async restore() {
    if(!this.journal)return;
    const latest=new Map<string,{server:string;revision:string;artifact:Artifact}>();
    for(const event of this.journal.events)if(event.type==='mcp.discovery.snapshot'){
      const payload=event.payload as {server:string;revision:string;artifact:Artifact};latest.set(payload.server,payload);
    }
    for(const [server,payload] of latest){
      const connection=this.connections.find(item=>item.resource.id===server&&item.exposure!=='hidden');
      if(!connection){await this.journal.append('mcp.discovery.restore',{server,revision:payload.revision,restored:false,reason:'server-unavailable'});continue;}
      const snapshot=JSON.parse((await readArtifact(this.journal.directory,payload.artifact)).toString()) as DiscoverySnapshot;
      const {revision,...body}=snapshot;
      if(snapshot.server!==server||revision!==payload.revision||hash(JSON.stringify(body))!==revision)throw new Error('Invalid MCP discovery snapshot');
      if(snapshot.resourceRevision!==connection.resource.hash){await this.journal.append('mcp.discovery.restore',{server,revision,restored:false,reason:'configuration-changed'});continue;}
      this.snapshots.set(server,snapshot);this.restored.add(server);
      await this.journal.append('mcp.discovery.restore',{server,revision,restored:true,requiresLiveVerification:true});
    }
  }
  declarations(){return [...this.snapshots.values()].map(snapshot=>({server:snapshot.server,revision:snapshot.revision,resourceRevision:snapshot.resourceRevision,requiresLiveVerification:this.restored.has(snapshot.server),tools:snapshot.tools.map(tool=>({id:tool.id,schemaHash:hash(JSON.stringify(tool.inputSchema))}))})).sort((a,b)=>a.server.localeCompare(b.server));}
  private async save(snapshot:DiscoverySnapshot){
    this.snapshots.set(snapshot.server,snapshot);this.restored.delete(snapshot.server);
    if(this.journal)await this.journal.append('mcp.discovery.snapshot',{server:snapshot.server,revision:snapshot.revision,artifact:await this.journal.artifact(JSON.stringify(snapshot))});
  }
  private connection(server: string) {
    const connection = this.connections.find(item => item.resource.id === server && item.exposure !== "hidden");
    if (!connection) throw new Error("Unknown or hidden MCP server identity");
    return connection;
  }
  async discover(server: string, signal: AbortSignal, offset = 0, limit = 20) {
    const connection = this.connection(server);
    await this.authorize(server);
    await connection.ready(signal);
    await this.authorize(server); signal.throwIfAborted();
    let snapshot = this.snapshots.get(server);
    if (!snapshot || this.restored.has(server)) {
      snapshot=this.capture(connection);
      await this.save(snapshot);
    }
    return { server, exposure: connection.exposure, revision: snapshot.revision, total: snapshot.tools.length, items: structuredClone(snapshot.tools.slice(offset, offset + limit)), ...(offset + limit < snapshot.tools.length ? { nextOffset: offset + limit } : {}) };
  }
  async call(server: string, tool: string, revision: string, args: Record<string, unknown>, signal: AbortSignal, fromScript: boolean) {
    const connection = this.connection(server);
    if (connection.exposure === "codemode" && !fromScript) throw new Error("This MCP server only permits Codemode tool calls");
    const snapshot = this.snapshots.get(server);
    if (!snapshot || snapshot.revision !== revision) throw new Error("Discover this MCP server and use its exact captured revision before calling");
    if(this.restored.has(server)) {
      await this.authorize(server);await connection.ready(signal);await this.authorize(server);
      if(this.capture(connection).revision!==snapshot.revision)throw new Error('Restored MCP tool version changed; explicitly discover the current server');
      this.restored.delete(server);
    }
    const definition = snapshot.tools.find(item => item.id === tool);
    if (!definition) throw new Error("Unknown MCP tool identity in the captured discovery");
    if (!Value.Check(definition.inputSchema as any, args)) throw new Error("Invalid arguments for the captured MCP tool schema");
    await this.authorize(server); signal.throwIfAborted();
    const result = await (async () => {
      try { return await connection.call(definition.name, structuredClone(args), signal); }
      finally {
        if (connection.cleanup) await this.journal?.append("mcp.cleanup", { server: connection.resource.id, ...connection.cleanup });
      }
    })();
    return { ...result, details: JSON.parse(JSON.stringify({ source: { server, tool, name: definition.name, revision }, raw: result.details })) };
  }
}
