/** This build supports explicit physical models only, including restored configuration. */
export function assertPhysicalRouting(routing: unknown): asserts routing is undefined | "physical" {
  if (routing !== undefined && routing !== "physical") {
    throw new Error("Unsupported model routing strategy; select an explicit physical model. Automatic routing and provider fallback are not enabled.");
  }
}
