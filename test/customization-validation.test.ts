import { expect, it } from "vitest";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { temporary } from "./helpers.js";
import { Resources } from "../src/customization/resources.js";
import { checkTypes } from "../src/customization/validation.js";
async function resource(source: string) {
  const workspace = await temporary(), home = await temporary();
  const root = join(workspace, ".nekomimi/extensions/check");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "extension.json"), JSON.stringify({ name: "check", sdkVersion: 1, entry: "index.ts" }));
  await writeFile(join(root, "index.ts"), source);
  return (await new Resources(workspace, home).discover()).find(r => r.kind === "extension")!;
}
it("reports semantic errors with location and a content-bound digest without executing factories", async () => {
  const r = await resource(`throw Error('MUST NOT EXECUTE');\nconst wrong: number = 'text';\nexport default api => {};`);
  const report = checkTypes(r);
  expect(report.passed).toBe(false);
  expect(report.diagnostics).toContainEqual(expect.objectContaining({ stage: "type", code: 2322, file: "index.ts", line: 2, resourceId: r.id, contentHash: report.contentHash }));
  const changed = checkTypes({ ...r, files: { ...r.files, "index.ts": "export default api=>{};" } });
  expect(changed.passed).toBe(true); expect(changed.contentHash).not.toBe(report.contentHash);
});
it("checks SDK calls and missing dependencies, and compiles the shipped SDK 1 example", async () => {
  const invalid = checkTypes(await resource(`import type { ExtensionFactory } from 'nekomimi/extensions'; export default ((api)=> { api.noSuchRegistration(); }) satisfies ExtensionFactory;`));
  expect(invalid.diagnostics.some(d => d.message.includes("noSuchRegistration"))).toBe(true);
  const emptySchema = checkTypes(await resource(`import type {ExtensionFactory} from 'nekomimi/extensions';export default ((api)=>{api.registerTool({name:'invalid',description:'invalid',parameters:{},async execute(){return {content:[]};}})}) satisfies ExtensionFactory;`));
  expect(emptySchema.diagnostics.some(d => d.message.includes("type"))).toBe(true);
  const missing = checkTypes(await resource(`import absent from 'not-an-installed-package'; export default api=>{};`));
  expect(missing.diagnostics.some(d => d.stage === "dependency")).toBe(true);
  const example = checkTypes(await resource(await readFile(new URL('../extension-docs/example.ts', import.meta.url), 'utf8')));
  expect(example.diagnostics).toEqual([]);
});
