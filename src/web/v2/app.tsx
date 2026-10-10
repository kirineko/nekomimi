import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { createRoot, type Root } from "react-dom/client";
import { createElement, StrictMode } from "react";
import "../styles/tokens.css";
import { router } from "./router";
import { ConnectionGate } from "./connection-gate";
import { createQueryClient } from "./state/query";

let root: Root | undefined;

/** 默认双工作台入口。调用方须先完成 connect。 */
export function mountWorkbench(element: HTMLElement) {
  const client = createQueryClient();
  root ??= createRoot(element);
  root.render(
    createElement(
      StrictMode,
      {},
      createElement(
        QueryClientProvider,
        { client },
        createElement(ConnectionGate, { children: createElement(RouterProvider, { router }) }),
      ),
    ),
  );
}
