import { useCoreStatus } from "./state/core-control";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DevValue } from "./dev-only";
import { useDeveloperView } from "./state/developer-view";

/**
 * 运行版本只在需要时出现（compact-header 规格）：
 * 版本无法确认或正在切换时始终显示并可直达恢复；正常情况下仅开发者视图显示。
 * 失败刷新绝不把缓存数据标为当前版本。
 */
export function CoreStatusBadge({
  onOpenRecovery,
}: {
  onOpenRecovery?: () => void;
}) {
  const query = useCoreStatus(true);
  const { enabled: developer } = useDeveloperView();
  const identity = query.data?.identity;
  const valid =
    typeof identity?.version === "string" &&
    typeof identity.build === "string" &&
    /^[a-f0-9]{64}$/.test(identity.build);

  if (query.isPending) return null;
  if (query.isError || !valid)
    return onOpenRecovery ? (
      <Button size="sm" variant="outline" className="text-warning" onClick={onOpenRecovery}>
        版本待确认
      </Button>
    ) : (
      <Badge state="warning">版本待确认</Badge>
    );
  if (query.data.phase === "switching")
    return <Badge state="warning">正在切换版本</Badge>;
  if (!developer) return null;
  return (
    <span data-testid="core-running-version" className="flex items-center gap-1 text-xs text-muted">
      {identity!.version}
      <DevValue label="运行构建" value={identity!.build} truncate={8} />
    </span>
  );
}
