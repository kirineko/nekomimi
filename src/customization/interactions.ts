import { basename } from "node:path";
import { Journal, id, hash } from "../journal.js";
import { ApiError } from "../shared/protocol.js";
import type { Contribution, Json } from "./types.js";
export interface PendingInteraction {
  id: string;
  sessionId: string;
  runId: string;
  resourceId: string;
  value: Contribution;
}
export class Interactions {
  private waiting = new Map<
    string,
    {
      item: PendingInteraction;
      answer: (value: Json, commandId: string) => Promise<void>;
      cancel: () => void;
    }
  >();
  list(sessionId: string) {
    return [...this.waiting.values()]
      .filter((w) => w.item.sessionId === sessionId)
      .map((w) => w.item);
  }
  async ask(
    journal: Journal,
    runId: string,
    resourceId: string,
    value: Contribution,
    signal: AbortSignal,
  ): Promise<Json> {
    signal.throwIfAborted();
    const interactionId = id();
    const item = {
      id: interactionId,
      sessionId: basename(journal.directory),
      runId,
      resourceId,
      value,
    };
    await journal.append("interaction.opened", item, { runId, resourceId });
    return new Promise<Json>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        this.waiting.delete(interactionId);
        signal.removeEventListener("abort", cancel);
        clearTimeout(timer);
      };
      const cancel = () => {
        if (settled) return;
        settled = true;
        cleanup();
        void journal
          .append(
            "interaction.cancelled",
            { id: interactionId },
            { runId, resourceId },
          )
          .then(
            () => reject(new Error("Interaction cancelled or timed out")),
            reject,
          );
      };
      const timer = setTimeout(cancel, 300000);
      this.waiting.set(interactionId, {
        item,
        cancel,
        answer: async (answer, commandId) => {
          if (settled || signal.aborted)
            throw new ApiError(409, "interaction_closed", "交互已结束");
          if (!answer || typeof answer !== "object" || Array.isArray(answer))
            throw new ApiError(400, "answer", "表单回答无效");
          for (const field of value.fields ?? []) {
            const v = answer[field.name];
            if (
              (v !== undefined && typeof v !== "string") ||
              (field.required && !v) ||
              (field.options && v && !field.options.includes(String(v)))
            )
              throw new ApiError(400, "answer", `字段无效: ${field.name}`);
          }
          settled = true;
          try {
            await journal.append(
              "interaction.answered",
              {
                id: interactionId,
                commandId,
                answer,
                payloadHash: hash(JSON.stringify(answer)),
              },
              { runId, resourceId },
            );
            cleanup();
            resolve(answer);
          } catch (e) {
            cleanup();
            reject(e);
            throw e;
          }
        },
      });
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
  async answer(
    sessionId: string,
    interactionId: string,
    commandId: string,
    value: Json,
  ) {
    const found = this.waiting.get(interactionId);
    if (!found || found.item.sessionId !== sessionId)
      throw new ApiError(409, "interaction_closed", "交互已结束");
    await found.answer(value, commandId);
    return { status: "answered" };
  }
}
