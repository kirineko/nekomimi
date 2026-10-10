import readline from 'node:readline';
export function handle(m) {
  const p = m.params ?? {}; let result;
  switch (m.method) {
    case 'initialize': result = { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: true }, resources: { subscribe: true, listChanged: true }, prompts: { listChanged: true } }, serverInfo: { name: 'fixture', version: '1' } }; break;
    case 'ping': result = {}; break;
    case 'tools/list': result = p.cursor ? { tools: [{ name: 'second', inputSchema: { type: 'object' } }] } : { tools: [{ name: 'echo', inputSchema: { type: 'object' } }], nextCursor: 'next' }; break;
    case 'tools/call':
      if (p.name === 'hang') return { hang: true };
      if (p.name === 'drop') return { drop: true };
      result = { content: [{ type: 'text', text: 'fixture' }], structuredContent: { received: p.arguments }, isError: p.name === 'error' }; break;
    case 'resources/list': result = p.cursor ? { resources: [{ uri: 'fixture://second', name: 'second' }] } : { resources: [{ uri: 'fixture://first', name: 'first' }], nextCursor: 'next' }; break;
    case 'resources/templates/list': result = p.cursor ? { resourceTemplates: [{ uriTemplate: 'fixture://second/{id}', name: 'second' }] } : { resourceTemplates: [{ uriTemplate: 'fixture://first/{id}', name: 'first' }], nextCursor: 'next' }; break;
    case 'resources/read': result = { contents: [{ uri: p.uri, mimeType: 'text/plain', text: 'resource-body' }] }; break;
    case 'prompts/list': result = { prompts: [{ name: 'review', arguments: [{ name: 'target', required: true }] }] }; break;
    case 'prompts/get': result = { messages: [{ role: 'user', content: { type: 'text', text: `review ${p.arguments.target}` } }] }; break;
    case 'resources/subscribe': return { result: {}, notification: { jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri: p.uri } } };
    case 'resources/unsubscribe': result = {}; break;
    default: if (m.id === undefined) return {}; return { error: { code: -32601, message: 'unsupported fixture method' } };
  }
  return { result };
}
if (process.argv.includes('--stdio')) {
  console.error('fixture-stderr-only');
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const m = JSON.parse(line), r = handle(m); if (r.drop) { process.exit(0); return; } if (r.hang || m.id === undefined) return;
    if (r.notification) console.log(JSON.stringify(r.notification));
    console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, ...(r.error ? { error: r.error } : { result: r.result }) }));
  });
}
