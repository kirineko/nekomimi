import {createContext} from "react";
export const LocateFile = createContext<((path: string) => void) | undefined>(
  undefined,
);
export type PanelTab = "files" | "changes" | "trace";
