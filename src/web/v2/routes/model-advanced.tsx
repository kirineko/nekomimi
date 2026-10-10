import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ModelManagement } from '../../../shared/model-management';
import { api, ClientError } from '../../api';
import { Button } from '../../ui/Button';
import { DialogRoot, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogActions, DialogClose } from '../../ui/Dialog';
import { ManagementConfirm } from './management-confirm';
export function ModelAdvanced({ data, sessionId }: { data: ModelManagement; sessionId?: string }) {
  const [open, setOpen] = useState(false), [omit, setOmit] = useState(false);
  const command = useRef<{ omit: boolean; id: string } | undefined>(undefined), client = useQueryClient();
  const branch = useMutation({ mutationFn: () => {
    if (!sessionId) throw new Error('需要绑定原会话');
    if (!command.current || command.current.omit !== omit) command.current = { omit, id: crypto.randomUUID() };
    return api<{ sessionId: string; mode: 'work' | 'create' }>('/customization', { action: 'history-branch', sessionId, omitReasoning: omit, commandId: command.current.id });
  }, onSuccess: async () => { setOpen(false); command.current = undefined; await client.invalidateQueries({ predicate: query => query.queryKey.includes('sessions') }); } });
  return <section aria-label="高级模型操作" className="my-4 space-y-3 rounded-lg border border-line p-3"><h2 className="text-base">高级模型操作</h2>
    <ManagementConfirm label="备份并迁移原 DeepSeek 配置" sessionId={sessionId} disabled={!!data.providerProfiles.entries['legacy-deepseek']} description="备份本地原配置并创建 legacy-deepseek 配置，保留现有用途选择，仅补齐未配置的默认、辅助和命名用途。凭证留在服务端；不会调用模型。" review={() => ({ request: { action: 'provider-migrate', revision: data.providerProfiles.revision }, detail: <><p>用户范围 · 配置修订 {data.providerProfiles.revision}</p><p>从本地已保存设置读取；进程启动参数不会迁入。</p></> })} />
    {data.providerProfiles.entries['legacy-deepseek'] && <p className="text-xs">已存在迁移配置，不能覆盖迁移。</p>}
    {!sessionId ? <p className="text-sm">从具体会话进入模型配置后，可创建跨 Provider 历史分支。</p> : <>
      <DialogRoot open={open} onOpenChange={value => { if (!branch.isPending) setOpen(value); }}><DialogTrigger asChild><Button variant="outline" disabled={data.busy} onClick={() => { branch.reset(); setOpen(true); }}>创建跨 Provider 历史分支</Button></DialogTrigger>
        <DialogContent><DialogTitle>创建跨 Provider 历史分支</DialogTitle><DialogDescription>保留原会话、原始证据和目标身份，复制可转换的对话，不执行工具或模型。未知工具结果必须先核对；分支后可明确选择模型并继续。</DialogDescription>
          <p className="my-3 break-all text-xs">来源会话 {sessionId}</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={omit} disabled={branch.isPending} onChange={event => setOmit(event.target.checked)} />允许新分支省略供应商专属 reasoning，保留其原始证据</label>
          {branch.isError && <p role="alert" className="mt-3 break-all text-sm text-danger">创建未确认：{branch.error instanceof ClientError && branch.error.code === 'history_reasoning_consent' ? '此历史包含供应商专属 reasoning，需要明确同意在新分支中省略' : branch.error instanceof ClientError && branch.error.code === 'history_branch_incomplete' ? '存在未确认的工具结果，请先核对，不能补造结果' : branch.error.message}。不会自动重试；相同选择重提使用原命令编号。</p>}
          <DialogActions><DialogClose asChild><Button variant="outline" disabled={branch.isPending}>取消分支</Button></DialogClose><Button busy={branch.isPending} onClick={() => branch.mutate()}>确认创建历史分支</Button></DialogActions>
        </DialogContent>
      </DialogRoot>
      {branch.data && <p role="status" className="text-sm">历史分支已创建。<Link className="underline" to={branch.data.mode === 'create' ? '/create/session/$sessionId' : '/work/session/$sessionId'} params={{ sessionId: branch.data.sessionId }}>打开历史分支</Link></p>}
    </>}
  </section>;
}
