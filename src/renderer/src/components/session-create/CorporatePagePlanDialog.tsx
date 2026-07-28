import type { ReactElement } from 'react'
import { FileText, LockKeyhole, Pencil } from 'lucide-react'
import type {
  ConfirmedCorporatePagePlan,
  ConfirmedCorporatePagePlanItem
} from '@shared/confirmed-corporate-plan'
import { updateConfirmedCorporatePagePlanItem } from '@shared/confirmed-corporate-plan'
import { Button } from '../ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/Dialog'
import { Input, Textarea } from '../ui/Input'

const ROLE_LABELS: Record<ConfirmedCorporatePagePlanItem['role'], string> = {
  cover: '封面',
  agenda: '目录',
  body: '正文',
  closing: '结束页'
}

export function CorporatePagePlanDialog({
  open,
  plan,
  fileName,
  onOpenChange,
  onPlanChange,
  onConfirm
}: {
  open: boolean
  plan: ConfirmedCorporatePagePlan | null
  fileName: string
  onOpenChange: (open: boolean) => void
  onPlanChange: (plan: ConfirmedCorporatePagePlan) => void
  onConfirm: () => void
}): ReactElement {
  const updateItem = (
    pageNumber: number,
    patch: Partial<Pick<ConfirmedCorporatePagePlanItem, 'title' | 'content'>>
  ): void => {
    if (!plan) return
    onPlanChange(updateConfirmedCorporatePagePlanItem(plan, pageNumber, patch))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl overflow-hidden border-[#e1d5c7] bg-[#f8f3eb] p-0">
        <DialogHeader className="border-b border-[#e6ddd1] bg-white px-6 py-5 pr-12">
          <DialogTitle className="flex items-center gap-2 text-[#3d3935]">
            <FileText className="h-4 w-4 text-[#e21b22]" />
            确认逐页生成计划
          </DialogTitle>
          <DialogDescription className="pt-1 text-xs leading-5 text-[#817b73]">
            已根据“{fileName}
            ”准备完整页面结构。封面和正文可编辑；目录随正文标题自动更新，结束页保持公司模板原样。
          </DialogDescription>
        </DialogHeader>

        {plan ? (
          <div className="max-h-[66vh] overflow-y-auto px-6 py-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#5e554d]">共 {plan.totalPages} 页</span>
              <span className="rounded-full bg-[#fff0e3] px-2.5 py-1 text-[11px] text-[#b45d24]">
                生成前全部可见
              </span>
            </div>
            <ol className="grid gap-3 md:grid-cols-2">
              {plan.items.map((item) => (
                <li
                  key={`${item.pageNumber}-${item.role}`}
                  data-confirmed-plan-card={item.role}
                  className="rounded-xl border border-[#e3d9cd] bg-white p-4 shadow-[0_7px_18px_rgba(76,76,76,0.05)]"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#f9e6d7] text-[11px] font-semibold text-[#a85127]">
                        {item.pageNumber}
                      </span>
                      <span className="text-xs font-semibold text-[#4b423b]">
                        {ROLE_LABELS[item.role]}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#f5f1ea] px-2 py-1 text-[10px] text-[#82786f]">
                      {item.editable ? (
                        <>
                          <Pencil className="h-3 w-3" /> 可编辑
                        </>
                      ) : (
                        <>
                          <LockKeyhole className="h-3 w-3" /> 自动/锁定
                        </>
                      )}
                    </span>
                  </div>

                  {item.editable ? (
                    <div className="space-y-2">
                      <label className="block text-[11px] font-medium text-[#756a60]">
                        {item.role === 'cover' ? '封面标题' : '页面标题'}
                      </label>
                      <Input
                        data-confirmed-plan-title={item.role}
                        value={item.title}
                        onChange={(event) =>
                          updateItem(item.pageNumber, { title: event.target.value })
                        }
                        className="h-9 border-[#ded3c6] bg-[#fffdf9] text-sm"
                      />
                      <label className="block text-[11px] font-medium text-[#756a60]">
                        {item.role === 'cover' ? '生成要求' : '本页事实要点'}
                      </label>
                      <Textarea
                        data-confirmed-plan-content={item.role}
                        value={item.content}
                        onChange={(event) =>
                          updateItem(item.pageNumber, { content: event.target.value })
                        }
                        className="min-h-24 resize-y border-[#ded3c6] bg-[#fffdf9] text-xs leading-5"
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg bg-[#faf7f2] px-3 py-3">
                      <h4 className="text-sm font-semibold text-[#4b423b]">{item.title}</h4>
                      <p
                        data-confirmed-plan-content={item.role}
                        className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#81766c]"
                      >
                        {item.content}
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <DialogFooter className="border-t border-[#e6ddd1] bg-white px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            稍后确认
          </Button>
          <Button
            data-confirm-corporate-plan
            className="bg-[#e21b22] text-white hover:bg-[#ba1218]"
            onClick={onConfirm}
          >
            确认并使用此计划
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
