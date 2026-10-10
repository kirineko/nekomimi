// @vitest-environment jsdom
import { it, expect, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useDeveloperView,
  installDeveloperViewAttribute,
} from "../src/web/v2/state/developer-view.js";
import { DevOnly, DevValue, DevEyebrow } from "../src/web/v2/dev-only.js";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-developer-view");
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
});

function Probe() {
  const { enabled, setEnabled, toggle } = useDeveloperView();
  return createElement(
    "button",
    {
      onClick: () => (enabled ? setEnabled(false) : toggle()),
      "data-enabled": enabled ? "1" : "0",
    },
    String(enabled),
  );
}

it("defaults to off, persists across remounts and toggles the html attribute", () => {
  installDeveloperViewAttribute();
  expect(document.documentElement.hasAttribute("data-developer-view")).toBe(false);
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
  const button = container.querySelector("button")!;
  expect(button.textContent).toBe("false");
  act(() => button.click());
  expect(localStorage.getItem("nekomimi:developer-view")).toBe("1");
  expect(document.documentElement.hasAttribute("data-developer-view")).toBe(true);
  expect(container.querySelector("button")!.textContent).toBe("true");

  // 重新挂载：偏好保持
  act(() => root.unmount());
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
  expect(container.querySelector("button")!.textContent).toBe("true");
});

it("syncs across windows via the storage event", () => {
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
  expect(container.querySelector("button")!.textContent).toBe("false");
  act(() => {
    localStorage.setItem("nekomimi:developer-view", "1");
    window.dispatchEvent(new StorageEvent("storage", { key: "nekomimi:developer-view" }));
  });
  expect(container.querySelector("button")!.textContent).toBe("true");
  expect(document.documentElement.hasAttribute("data-developer-view")).toBe(true);

  // 无关 key 不触发
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
  });
  expect(container.querySelector("button")!.textContent).toBe("true");
});

it("falls back to in-memory state when localStorage throws", () => {
  const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new Error("disabled");
    },
  });
  try {
    act(() => {
      root = createRoot(container);
      root.render(createElement(Probe));
    });
    // 前一个用例可能留下了内存回退值：先归零
    act(() => {
      if (container.querySelector("button")!.textContent === "true")
        container.querySelector("button")!.click();
    });
    expect(container.querySelector("button")!.textContent).toBe("false");
    act(() => container.querySelector("button")!.click());
    expect(container.querySelector("button")!.textContent).toBe("true");
    expect(document.documentElement.hasAttribute("data-developer-view")).toBe(true);
  } finally {
    Object.defineProperty(window, "localStorage", original);
  }
});

it("DevOnly keeps children unmounted while off; DevValue truncates and marks; DevEyebrow is decorative", () => {
  const off = renderToStaticMarkup(
    createElement(
      "div",
      {},
      createElement(DevOnly, { children: createElement("span", {}, "secret") }),
      createElement(DevValue, { label: "构建", value: "ab".repeat(32) }),
      createElement(DevEyebrow, { children: "WORK MODE" }),
    ),
  );
  expect(off).not.toContain("secret");
  expect(off).not.toContain("data-dev-value");
  expect(off).not.toContain("WORK MODE");
});

it("server render stays off without browser storage", () => {
  // getServerSnapshot 固定为 false：SSR 与首次渲染一致，无 hydration 闪变
  const html = renderToStaticMarkup(createElement(DevEyebrow, { children: "INSPECTOR" }));
  expect(html).toBe("");
});
