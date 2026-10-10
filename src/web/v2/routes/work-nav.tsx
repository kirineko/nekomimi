import {useSessionCatalog} from '../state/session-catalog';
import {SessionCatalog} from './session-catalog';
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { api } from "../../api";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { v2Host, v2Key } from "../state/query";
import { DevEyebrow } from "../dev-only";

/** 工作台会话列表：真实只读查询，key 含宿主/模式/目标；创建是显式 mutation，不自动重试。 */
export function WorkNavigation({ active }: { active?: string }) {
  const query = useSessionCatalog('work');
  const navigate = useNavigate();
  const client = useQueryClient();
  const [title, setTitle] = useState("");
  const creation = useRef<{ title: string; commandId: string } | undefined>(undefined);
  const create = useMutation({
    mutationFn: (request: { title: string; commandId: string }) =>
      api<{ id: string }>("/sessions", { version: 1, mode: "work", ...request }),
    onSuccess: async (session) => {
      creation.current = undefined;
      await client.invalidateQueries({
        queryKey: v2Key(v2Host(), "work", "default", undefined, "sessions"),
      });
      void navigate({ to: "/work/session/$sessionId", params: { sessionId: session.id } });
    },
  });

  return (
    <nav aria-label="项目与会话" className="flex flex-col gap-3">
      <DevEyebrow>WORKSPACE</DevEyebrow>
      <h2 className="text-base">我的项目</h2>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if(create.isPending)return;
          const name = title.trim() || "未命名任务";
          if (!creation.current || creation.current.title !== name) creation.current = { title: name, commandId: crypto.randomUUID() };
          create.mutate(creation.current);
        }}
      >
        <Button type="submit" busy={create.isPending}>
          + 新任务
        </Button>
        <details className="text-xs">
          <summary>命名后创建</summary>
          <Input
            aria-label="新会话标题"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="新任务…"
            className="mt-2"
          />
        </details>
      </form>
      {create.isError && (
        <p role="alert" className="text-xs text-danger">
          创建失败：{String(create.error instanceof Error ? create.error.message : create.error)}。请重新提交。
        </p>
      )}
      <SessionCatalog mode="work" active={active} query={query} />
    </nav>
  );
}
