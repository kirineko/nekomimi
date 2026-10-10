import { describe, expect, it } from "vitest";
import type { PanelView } from "../src/web/components/CustomPanel.js";
import { validateSlot, SLOT_CONTRACT_VERSION } from "../src/web/v2/slots.js";

const panel = { id: "p1", resourceId: "r1", revision: "v1", fallback: "f", slot: "sidebar-widget", bundleHash: "h" } as PanelView;

describe("v2 slot 契约校验", () => {
  it("旧契约（缺失或低于 3）被拒绝", () => {
    expect(validateSlot({ id: "p", panel }, { mode: "work", target: "t" })).toMatchObject({ ok: false });
    expect(
      validateSlot({ id: "p", panel, contractVersion: 1, modes: ["work"], targetScope:"current", resourceRevision: "v1" }, { mode: "work", target: "t" }),
    ).toMatchObject({ ok: false });
  });

  it("跨模式声明不挂载", () => {
    const verdict = validateSlot(
      { id: "p", panel, contractVersion: SLOT_CONTRACT_VERSION, modes: ["create"], targetScope:"current", resourceRevision: "v1" },
      { mode: "work", target: "t" },
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("不适用");
  });

  it("缺少资源版本被拒绝", () => {
    expect(
      validateSlot({ id: "p", panel, contractVersion: SLOT_CONTRACT_VERSION, modes: ["work"] }, { mode: "work", target: "t" }),
    ).toMatchObject({ ok: false });
  });

  it("不明目标或不匹配的资源版本被拒绝", () => {
    const declaration={id:'p',panel,contractVersion:3,modes:['work' as const],targetScope:'current' as const,resourceRevision:'v1'};
    for(const patch of [{targetScope:undefined},{resourceRevision:'another'}])
      expect(validateSlot({...declaration,...patch},{mode:'work',target:'t'}).ok).toBe(false);
    expect(validateSlot(declaration,{mode:'work',target:''}).ok).toBe(false);
  });

  it("合规声明通过", () => {
    expect(
      validateSlot(
        { id: "p", panel, contractVersion: SLOT_CONTRACT_VERSION, modes: ["work", "create"], targetScope:"current", resourceRevision: "v1" },
        { mode: "work", target: "t" },
      ),
    ).toMatchObject({ ok: true });
  });
});
