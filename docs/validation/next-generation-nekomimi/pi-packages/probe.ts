import { Agent, runToolCall, type AgentOptions } from '@earendil-works/pi-agent-core';
import { createModels, type Api, type Model } from '@earendil-works/pi-ai';
import { stream as streamOpenAIResponses } from '@earendil-works/pi-ai/api/openai-responses';
import { CodemodeSandbox, type CodemodeTool } from '@earendil-works/pi-codemode';
import { Harness, MemoryStorage, type Storage } from '@earendil-works/pi-durable';
import { McpClient, StdioTransport, type McpClientOptions } from '@earendil-works/pi-mcp';

const tool: CodemodeTool = { name: 'echo', execute: async args => args };
const storage: Storage = new MemoryStorage();
const options: AgentOptions = { streamFn: () => { throw new Error('No model call in type probe'); } };
const sandbox = new CodemodeSandbox({ tools: [tool] });
void [Agent, runToolCall, createModels, streamOpenAIResponses, Harness, McpClient, StdioTransport, storage, options, sandbox];
export type Types = [Model<Api>, McpClientOptions];
