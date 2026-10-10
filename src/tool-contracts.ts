import type { Static, TSchema } from "typebox";
import type { Content } from "./customization/types.js";

/** Product execution contracts. Framework adapters translate these at their boundary. */
export interface ToolUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface RuntimeToolResult<T = unknown> {
  content: Content[];
  details: T;
  usage?: ToolUsage;
  addedToolNames?: string[];
  terminate?: boolean;
}

export interface RuntimeTool<TParameters extends TSchema = TSchema, TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  parameters: TParameters;
  prepareArguments?: (args: unknown) => Static<TParameters>;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: (result: RuntimeToolResult<TDetails>) => void,
  ) => Promise<RuntimeToolResult<TDetails>>;
}
