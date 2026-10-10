import { useState } from "react";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import {
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "../../ui/Dialog";
import { Input, Select, Textarea } from "../../ui/Input";
import { Menu } from "../../ui/Menu";
import { TabPanel, Tabs } from "../../ui/Tabs";
import { ToastItem, Toasts } from "../../ui/Toast";
import { Tooltip } from "../../ui/Tooltip";
import { EmptyState, ErrorState } from "../../ui/StateCard";

/**
 * 控件展示页（过渡开发用途）：覆盖 D11 要求的控件及等待/失败/危险/禁用/焦点状态，
 * 供 design-system 浏览器验证与人工评审使用；不含任何业务 API。
 */
export function DevUiPage() {
  const [tab, setTab] = useState("one");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  return (
    <main className="ds overflow-auto p-6" data-testid="dev-ui">
      <h1>设计系统控件</h1>

      <h2 className="mt-6">Button</h2>
      <div className="flex flex-wrap items-center gap-3">
        <Button>默认</Button>
        <Button variant="secondary">次要</Button>
        <Button variant="outline">描边</Button>
        <Button variant="ghost">幽灵</Button>
        <Button variant="destructive">危险操作</Button>
        <Button disabled>禁用</Button>
        <Button busy>等待中</Button>
      </div>

      <h2 className="mt-6">Input / Select / Textarea</h2>
      <div className="flex max-w-md flex-col gap-3">
        <Input aria-label="示例输入" placeholder="普通输入" />
        <Input aria-label="无效输入" aria-invalid value="格式错误" readOnly />
        <Input aria-label="禁用输入" disabled placeholder="禁用" />
        <Select aria-label="示例选择">
          <option>选项一</option>
          <option>选项二</option>
        </Select>
        <Textarea aria-label="示例多行" placeholder="多行输入" />
      </div>

      <h2 className="mt-6">Badge</h2>
      <div className="flex gap-2">
        <Badge>默认</Badge>
        <Badge state="ok">正常</Badge>
        <Badge state="warning">待授权</Badge>
        <Badge state="danger">错误</Badge>
      </div>

      <h2 className="mt-6">Dialog</h2>
      <DialogRoot>
        <DialogTrigger asChild>
          <Button variant="outline">打开对话框</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>确认操作</DialogTitle>
          <DialogDescription>Escape 关闭并恢复焦点。</DialogDescription>
          <DialogActions>
            <DialogClose asChild>
              <Button>确认</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
          </DialogActions>
        </DialogContent>
      </DialogRoot>

      <h2 className="mt-6">Menu</h2>
      <Menu
        ariaLabel="更多操作"
        trigger={<Button variant="outline">更多操作 ▾</Button>}
        items={[
          { id: "rename", label: "重命名" },
          { id: "disabled", label: "不可用项", disabled: true },
          { id: "delete", label: "删除", danger: true },
        ]}
      />

      <h2 className="mt-6">Tabs</h2>
      <Tabs
        ariaLabel="示例选项卡"
        value={tab}
        onChange={setTab}
        items={[
          { id: "one", label: "第一页" },
          { id: "two", label: "第二页" },
          { id: "three", label: "不可用", disabled: true },
        ]}
      />
      <TabPanel id="one" active={tab === "one"} className="p-3">
        第一页内容
      </TabPanel>
      <TabPanel id="two" active={tab === "two"} className="p-3">
        第二页内容
      </TabPanel>

      <h2 className="mt-6">Tooltip</h2>
      <Tooltip label="这是提示文本">
        <Button variant="outline">悬停或聚焦查看提示</Button>
      </Tooltip>

      <h2 className="mt-6">Toast</h2>
      <Button
        variant="outline"
        onClick={() =>
          setToasts((items) => [
            ...items,
            { id: crypto.randomUUID(), title: "操作完成", detail: "这是一条通知。" },
          ])
        }
      >
        显示通知
      </Button>
      <Button
        variant="outline"
        className="ml-2"
        onClick={() =>
          setToasts((items) => [
            ...items,
            { id: crypto.randomUUID(), title: "操作失败", tone: "danger", detail: "错误详情。" },
          ])
        }
      >
        显示错误通知
      </Button>
      <Toasts
        items={toasts}
        onDismiss={(id) => setToasts((items) => items.filter((item) => item.id !== id))}
      />

      <h2 className="mt-6">Empty / Error</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <EmptyState title="从一个清晰的任务开始" detail="空状态说明文字。" />
        <ErrorState
          title="验证失败，原候选保持不变"
          detail="错误状态使用 role=alert。"
          actions={<Button variant="outline">重试</Button>}
        />
      </div>
    </main>
  );
}
