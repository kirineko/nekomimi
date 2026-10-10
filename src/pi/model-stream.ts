import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { PreparedRequestContext } from "../context-snapshot.js";

/** Internal AI adapter signature. Business commands and browser protocols never import it. */
export type RecordedModelContext = Context & { productContext?: PreparedRequestContext };
export type RecordedModelStream = (model: Model<Api>, context: RecordedModelContext, options?: SimpleStreamOptions) => AssistantMessageEventStream;
