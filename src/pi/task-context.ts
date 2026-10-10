import type { Context } from "@earendil-works/chord";
import { withAbortSignal } from "@earendil-works/chord/context";
import type { Journal } from "../journal.js";

/** Bind framework waits and dispatch to the product's fail-closed journal boundary. */
export function durableContext(journal: Journal, parent: Context, signal?: AbortSignal): Context {
  journal.check();
  signal?.throwIfAborted();
  return withAbortSignal(signal ? AbortSignal.any([journal.failure.signal, signal]) : journal.failure.signal, parent);
}
