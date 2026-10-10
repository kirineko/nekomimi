import { expect, it } from "vitest";
import { legacyIdentity, packageIdentity, requireCapabilities, V2_CAPABILITIES } from "../src/customization/contracts.js";
import type { ExtensionAPI, ExtensionAPI3, ExtensionContext, ExtensionFactory, ExtensionFactory3, PackageManifest } from "../src/extensions.js";
import { checkManifest } from "../src/customization/types.js";

// Both public factory names describe the current SDK 3 contract; old manifests are rejected.
const currentFactory: ExtensionFactory = (api: ExtensionAPI) => {
  api.registerCommand("compat", { description: "Compatibility", async handler(_args, ctx: ExtensionContext) {
    await ctx.state.set("counter", 1, 1);
    ctx.followUp("next");
    return ctx.reload().id;
  } });
};
const namedFactory: ExtensionFactory3 = currentFactory;
const newFactory: ExtensionFactory3 = (api: ExtensionAPI3) => {
  api.registerWorkflow({ id: "review", schemaVersion: 1, inputSchema: { type: "object" }, entry: "done", steps: {
    done: { transitions: [], async execute() { return { kind: "complete", output: null }; } },
  } });
};
const manifest: PackageManifest = { manifestVersion: 1, name: "review", version: "1.0.0", sdkVersion: 3, requiredCapabilities: ["commands"], resources: [], dependencies: {} };
void namedFactory; void newFactory; void manifest;

it("separates code revision from identity and never adopts trust from another source", () => {
  const before = packageIdentity("npm:registry/package", "review", "command", "a");
  const after = packageIdentity("npm:registry/package", "review", "command", "b");
  expect(after.resourceId).toBe(before.resourceId);
  expect(after.stateNamespace).toBe(before.stateNamespace);
  expect(after.revision).not.toBe(before.revision);
  expect(packageIdentity("git:other", "review", "command", "a").resourceId).not.toBe(before.resourceId);
  expect(legacyIdentity("old-resource-id", "new-code").stateNamespace).toBe("old-resource-id");
});
it("rejects both unknown contracts and known but unavailable runtime capabilities", () => {
  for (const sdkVersion of [0, 1, 2, 4, "3"]) expect(() => checkManifest({ name: "future", sdkVersion, entry: "index.ts" })).toThrow("sdkVersion");
  expect(checkManifest({ name: "current", sdkVersion: 3, entry: "index.ts", requiredCapabilities: ["commands"] }).sdkVersion).toBe(3);
  expect(() => checkManifest({ name: "future", sdkVersion: 3, entry: "index.ts", requiredCapabilities: ["unsupported-capability"] })).toThrow("Unsupported");
  expect(() => requireCapabilities(["future"], V2_CAPABILITIES)).toThrow("Unsupported");
  expect(() => requireCapabilities(["providers"], ["tools"])).toThrow("Unsupported");
  expect(() => requireCapabilities(["tools", "commands"], V2_CAPABILITIES)).not.toThrow();
});
