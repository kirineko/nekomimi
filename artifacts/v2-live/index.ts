import type {
  ExtensionFactory2,
  ExtensionTool,
  ExtensionCommand,
  Json,
  ProviderDefinition,
  ProviderInput,
  ProviderOutput,
  StepOutcome,
  ToolResult,
  WorkflowContext,
  WorkflowDefinition,
  PanelDefinition,
} from 'nekomimi/extensions';

/** Join the text parts of a ToolResult so commands can return the read text. */
const textOf = (result: ToolResult): string =>
  result.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');

/** Parser state for the demo provider, bounded per requestId. */
const pending = new Map<string, string>();

export default ((api) => {
  api.registerTool({
    name: 'live_read',
    description: 'Read sample.txt and return the synthetic live read result.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx): Promise<ToolResult> {
      return await ctx.callTool('read', { path: 'sample.txt' });
    },
  } satisfies ExtensionTool);

  api.registerCommand('live-check', {
    description: 'Read sample.txt through live_read, record the live panel and return the read text.',
    async handler(_args, ctx): Promise<string> {
      const result = await ctx.callTool('ext_live_live_read', {});
      await ctx.ui({
        kind: 'panel',
        title: 'Live panel',
        panelId: 'live-panel',
        props: { items: ['SYNTHETIC_V2_INPUT'] },
      });
      return textOf(result);
    },
  } satisfies ExtensionCommand);

  api.registerCommand('live-model', {
    description: 'Run the auxiliary model on a synthetic provider prompt.',
    async handler(_args, ctx): Promise<string> {
      return await ctx.model('Synthetic provider test');
    },
  } satisfies ExtensionCommand);

  api.registerProvider({
    id: 'live-provider',
    models: [
      {
        id: 'live-model',
        name: 'Live',
        protocol: 'live-json',
        historyCompatibility: 'live-json-v1',
        contextWindow: 32000,
        maxOutputTokens: 1024,
        capabilities: { tools: false, images: false, reasoning: false },
      },
    ],
    async serialize(input: ProviderInput): Promise<{ body: Json; path: string }> {
      return { body: { model: input.model.id, prompt: input.instructions }, path: '/generate' };
    },
    async parse({
      requestId,
      chunk,
      final,
    }: {
      requestId: string;
      sequence: number;
      chunk: string;
      final: boolean;
    }): Promise<ProviderOutput | null> {
      const accumulated = (pending.get(requestId) ?? '') + chunk;
      if (!final) {
        pending.set(requestId, accumulated);
        return null;
      }
      pending.delete(requestId);
      const parsed = JSON.parse(accumulated) as { text: string };
      return {
        rawItems: [parsed],
        contextItems: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: parsed.text }],
          },
        ],
        projection: { content: [{ type: 'text', text: parsed.text }] },
        terminal: 'completed',
      };
    },
  } satisfies ProviderDefinition);

  api.registerWorkflow({
    id: 'live-flow',
    schemaVersion: 1,
    inputSchema: { type: 'object' },
    entry: 'inspect',
    steps: {
      inspect: {
        transitions: ['finish'],
        async execute(_input: Json, ctx: WorkflowContext): Promise<StepOutcome> {
          await ctx.callTool('read', { path: 'sample.txt' });
          return {
            kind: 'wait',
            step: 'finish',
            input: { evidence: 'SYNTHETIC_V2_INPUT' },
            form: {
              kind: 'form',
              title: 'Live approval',
              fields: [
                {
                  name: 'decision',
                  label: 'decision',
                  required: true,
                  options: ['approve', 'reject'],
                },
              ],
            },
          };
        },
      },
      finish: {
        transitions: [],
        async execute(input: Json): Promise<StepOutcome> {
          return { kind: 'complete', output: input };
        },
      },
    },
  } satisfies WorkflowDefinition);

  api.registerPanel({
    id: 'live-panel',
    uiVersion: 1,
    entry: 'panel.ts',
    slot: 'sidebar',
    propsSchema: {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'string' } } },
      required: ['items'],
    },
    actions: [],
    fallback: 'Live panel fallback',
  } satisfies PanelDefinition);
}) satisfies ExtensionFactory2;
