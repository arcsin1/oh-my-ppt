import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, Clapperboard, Loader2 } from 'lucide-react'
import {
  INDEX_TRANSITION_PRESETS,
  type IndexTransitionConfig,
  type IndexTransitionType
} from '@shared/index-transition.js'
import { useT, type I18nKey } from '@renderer/i18n'
import { ipc } from '@renderer/lib/ipc'
import { useSessionDetailUiStore, useToastStore } from '@renderer/store'
import { Popover, PopoverContent, PopoverTrigger } from '../../../../ui/Popover'

interface IndexTransitionPickerProps {
  disabled?: boolean
}

const transitionPreviewStyles = `
.ppt-index-transition-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.ppt-index-transition-card {
  position: relative;
  min-width: 0;
  height: 88px;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid rgba(216, 204, 181, 0.82);
  background: linear-gradient(180deg, rgba(255,253,248,0.98), rgba(246,241,229,0.96));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.72), 0 8px 18px rgba(74,59,42,0.08);
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}
.ppt-index-transition-card:hover,
.ppt-index-transition-card:focus-visible {
  transform: translateY(-1px);
  border-color: rgba(111,129,89,0.58);
  background: linear-gradient(180deg, rgba(255,253,248,1), rgba(238,245,229,0.98));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.78), 0 12px 24px rgba(74,59,42,0.12);
  outline: none;
}
.ppt-index-transition-card[data-selected="true"] {
  border-color: rgba(93,107,77,0.78);
  box-shadow: inset 0 0 0 1px rgba(93,107,77,0.22), 0 12px 24px rgba(74,59,42,0.1);
}
.ppt-index-transition-card:disabled {
  cursor: not-allowed;
  opacity: 0.58;
  transform: none;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.62);
}
.ppt-index-transition-card-label {
  position: absolute;
  left: 8px;
  right: 30px;
  bottom: 7px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  color: #314028;
}
.ppt-index-transition-card-check {
  position: absolute;
  right: 7px;
  bottom: 6px;
  display: inline-flex;
  width: 17px;
  height: 17px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #5d6b4d;
  color: #fff;
}
.ppt-index-transition-stage {
  position: absolute;
  left: 8px;
  right: 8px;
  top: 8px;
  height: 50px;
  overflow: hidden;
  border-radius: 6px;
  background:
    linear-gradient(90deg, rgba(229,221,204,0.9) 1px, transparent 1px) 0 0 / 14px 14px,
    linear-gradient(0deg, rgba(229,221,204,0.72) 1px, transparent 1px) 0 0 / 14px 14px,
    #fbf8f1;
  perspective: 220px;
}
.ppt-index-transition-frame {
  position: absolute;
  inset: 7px 14px;
  border-radius: 5px;
  border: 1px solid rgba(80,69,52,0.16);
  background: linear-gradient(135deg, #5d6b4d 0%, #8fbc8f 44%, #f1b56f 100%);
  box-shadow: 0 6px 12px rgba(62,74,50,0.16);
  transform-origin: center;
}
.ppt-index-transition-frame-old {
  opacity: 0.42;
  background: linear-gradient(135deg, #d8ccb5 0%, #a9b793 100%);
}
.ppt-index-transition-card[data-transition-type="fade"] .ppt-index-transition-frame-new {
  animation: pptIndexTransitionFade 1.7s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="slide-left"] .ppt-index-transition-frame-new {
  animation: pptIndexTransitionSlideLeft 1.8s cubic-bezier(0.2,0.82,0.22,1) infinite;
}
.ppt-index-transition-card[data-transition-type="slide-up"] .ppt-index-transition-frame-new {
  animation: pptIndexTransitionSlideUp 1.8s cubic-bezier(0.2,0.82,0.22,1) infinite;
}
.ppt-index-transition-card[data-transition-type="push"] .ppt-index-transition-frame-old {
  animation: pptIndexTransitionPushOld 1.8s cubic-bezier(0.2,0.82,0.22,1) infinite;
}
.ppt-index-transition-card[data-transition-type="push"] .ppt-index-transition-frame-new {
  animation: pptIndexTransitionPushNew 1.8s cubic-bezier(0.2,0.82,0.22,1) infinite;
}
.ppt-index-transition-card[data-transition-type="wipe"] .ppt-index-transition-frame-new {
  animation: pptIndexTransitionWipe 1.9s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="zoom"] .ppt-index-transition-frame-new {
  animation: pptIndexTransitionZoom 1.8s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="flip"] .ppt-index-transition-frame-new {
  animation: pptIndexTransitionFlip 2s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="stack"] .ppt-index-transition-frame-old {
  animation: pptIndexTransitionStackOld 1.9s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="stack"] .ppt-index-transition-frame-new {
  animation: pptIndexTransitionStackNew 1.9s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="rotate"] .ppt-index-transition-frame-old {
  animation: pptIndexTransitionRotateOld 1.9s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="rotate"] .ppt-index-transition-frame-new {
  animation: pptIndexTransitionRotateNew 1.9s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="cube"] .ppt-index-transition-frame-old {
  transform-origin: left center;
  animation: pptIndexTransitionCubeOld 2s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="cube"] .ppt-index-transition-frame-new {
  transform-origin: right center;
  animation: pptIndexTransitionCubeNew 2s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="cover-flow"] .ppt-index-transition-frame-old {
  animation: pptIndexTransitionCoverOld 2s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="cover-flow"] .ppt-index-transition-frame-new {
  animation: pptIndexTransitionCoverNew 2s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="blur"] .ppt-index-transition-frame-old {
  animation: pptIndexTransitionBlurOld 1.9s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="blur"] .ppt-index-transition-frame-new {
  animation: pptIndexTransitionBlurNew 1.9s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="iris"] .ppt-index-transition-frame-new {
  animation: pptIndexTransitionIris 2s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="swing"] .ppt-index-transition-frame-old {
  animation: pptIndexTransitionSwingOld 2s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="swing"] .ppt-index-transition-frame-new {
  animation: pptIndexTransitionSwingNew 2s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="center-reveal"] .ppt-index-transition-frame-new {
  animation: pptIndexTransitionCenterReveal 1.9s ease-in-out infinite;
}
.ppt-index-transition-card[data-transition-type="none"] .ppt-index-transition-frame-new {
  transform: translateX(8px) translateY(-3px);
  opacity: 0.78;
}
@keyframes pptIndexTransitionFade {
  0%, 18% { opacity: 0; }
  48%, 100% { opacity: 1; }
}
@keyframes pptIndexTransitionSlideLeft {
  0%, 18% { transform: translateX(105%); }
  54%, 100% { transform: translateX(0); }
}
@keyframes pptIndexTransitionSlideUp {
  0%, 18% { transform: translateY(105%); }
  54%, 100% { transform: translateY(0); }
}
@keyframes pptIndexTransitionPushOld {
  0%, 18% { transform: translateX(0); opacity: 0.42; }
  54%, 100% { transform: translateX(-72%); opacity: 0.18; }
}
@keyframes pptIndexTransitionPushNew {
  0%, 18% { transform: translateX(105%); }
  54%, 100% { transform: translateX(0); }
}
@keyframes pptIndexTransitionWipe {
  0%, 18% { clip-path: inset(0 0 0 100%); }
  58%, 100% { clip-path: inset(0 0 0 0); }
}
@keyframes pptIndexTransitionZoom {
  0%, 18% { transform: scale(1.18); opacity: 0; }
  54%, 100% { transform: scale(1); opacity: 1; }
}
@keyframes pptIndexTransitionFlip {
  0%, 18% { transform: rotateY(74deg); opacity: 0; }
  58%, 100% { transform: rotateY(0deg); opacity: 1; }
}
@keyframes pptIndexTransitionStackOld {
  0%, 18% { transform: translateY(0) scale(1); opacity: 0.42; }
  58%, 100% { transform: translateY(8px) scale(0.94); opacity: 0.22; }
}
@keyframes pptIndexTransitionStackNew {
  0%, 18% { transform: translateY(-12px) scale(0.94); opacity: 0; }
  58%, 100% { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes pptIndexTransitionRotateOld {
  0%, 18% { transform: rotate(0deg) scale(1); opacity: 0.42; }
  58%, 100% { transform: rotate(-9deg) scale(0.88); opacity: 0; }
}
@keyframes pptIndexTransitionRotateNew {
  0%, 18% { transform: rotate(10deg) scale(1.12); opacity: 0; }
  58%, 100% { transform: rotate(0deg) scale(1); opacity: 1; }
}
@keyframes pptIndexTransitionCubeOld {
  0%, 18% { transform: translateX(0) rotateY(0deg); opacity: 0.42; }
  58%, 100% { transform: translateX(-26%) rotateY(-76deg); opacity: 0.12; }
}
@keyframes pptIndexTransitionCubeNew {
  0%, 18% { transform: translateX(36%) rotateY(76deg); opacity: 0.12; }
  58%, 100% { transform: translateX(0) rotateY(0deg); opacity: 1; }
}
@keyframes pptIndexTransitionCoverOld {
  0%, 18% { transform: translateX(0) scale(1) rotateY(0deg); opacity: 0.42; }
  58%, 100% { transform: translateX(-34%) scale(0.78) rotateY(38deg); opacity: 0.18; }
}
@keyframes pptIndexTransitionCoverNew {
  0%, 18% { transform: translateX(34%) scale(0.78) rotateY(-38deg); opacity: 0.22; }
  58%, 100% { transform: translateX(0) scale(1) rotateY(0deg); opacity: 1; }
}
@keyframes pptIndexTransitionBlurOld {
  0%, 18% { transform: scale(1); filter: blur(0); opacity: 0.42; }
  58%, 100% { transform: scale(1.08); filter: blur(4px); opacity: 0; }
}
@keyframes pptIndexTransitionBlurNew {
  0%, 18% { transform: scale(0.94); filter: blur(4px); opacity: 0; }
  58%, 100% { transform: scale(1); filter: blur(0); opacity: 1; }
}
@keyframes pptIndexTransitionIris {
  0%, 18% { clip-path: circle(0% at 50% 50%); opacity: 1; }
  62%, 100% { clip-path: circle(78% at 50% 50%); opacity: 1; }
}
@keyframes pptIndexTransitionSwingOld {
  0%, 18% { transform: translateX(0) rotate(0deg) scale(1); opacity: 0.42; }
  58%, 100% { transform: translateX(-18%) rotate(-12deg) scale(0.94); opacity: 0; }
}
@keyframes pptIndexTransitionSwingNew {
  0%, 18% { transform: translateX(20%) rotate(12deg) scale(0.96); opacity: 0; }
  58%, 100% { transform: translateX(0) rotate(0deg) scale(1); opacity: 1; }
}
@keyframes pptIndexTransitionCenterReveal {
  0%, 18% { clip-path: inset(0 50% 0 50%); transform: scale(1.02); opacity: 1; }
  62%, 100% { clip-path: inset(0 0 0 0); transform: scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .ppt-index-transition-card,
  .ppt-index-transition-frame {
    animation: none !important;
    transition: none !important;
  }
}
`

export function IndexTransitionPicker({
  disabled = false
}: IndexTransitionPickerProps): React.JSX.Element {
  const { id: sessionId } = useParams<{ id: string }>()
  const t = useT()
  const toastSuccess = useToastStore((state) => state.success)
  const toastError = useToastStore((state) => state.error)
  const bumpPreviewKey = useSessionDetailUiStore((state) => state.bumpPreviewKey)
  const [transition, setTransition] = useState<IndexTransitionConfig | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [open, setOpen] = useState(false)

  const options = useMemo(
    () =>
      INDEX_TRANSITION_PRESETS.map((preset) => ({
        ...preset,
        label: t(preset.labelKey as I18nKey)
      })),
    [t]
  )

  useEffect(() => {
    if (!sessionId) {
      setTransition(null)
      return
    }
    let cancelled = false
    setIsLoading(true)
    void ipc
      .getIndexTransition(sessionId)
      .then((config) => {
        if (!cancelled) setTransition(config)
      })
      .catch((error) => {
        if (!cancelled) {
          toastError(
            error instanceof Error ? error.message : t('sessionDetail.indexTransitionLoadFailed')
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, t, toastError])

  const currentType = transition?.type ?? 'fade'
  const currentOption =
    options.find((option) => option.type === currentType) ??
    options.find((option) => option.type === 'fade') ??
    options[0]
  const disabledState = disabled || isLoading || isSaving || !sessionId
  const TriggerIcon = isLoading || isSaving ? Loader2 : Clapperboard

  const handleTransitionChange = async (type: IndexTransitionType): Promise<void> => {
    if (!sessionId || disabled || isSaving) return
    const selected = INDEX_TRANSITION_PRESETS.find((preset) => preset.type === type)
    if (!selected) return
    const previous = transition
    if (previous?.type === type && previous.durationMs === selected.durationMs) {
      setOpen(false)
      return
    }
    const optimisticConfig = { type, durationMs: selected.durationMs }
    setTransition(optimisticConfig)
    setOpen(false)
    setIsSaving(true)
    try {
      const result = await ipc.setIndexTransition({
        sessionId,
        type,
        durationMs: selected.durationMs
      })
      setTransition(result.transition)
      bumpPreviewKey()
      toastSuccess(t('sessionDetail.indexTransitionSaved'))
    } catch (error) {
      setTransition(previous)
      toastError(error instanceof Error ? error.message : t('sessionDetail.indexTransitionSaveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabledState}
          className="inline-flex h-7 max-w-[190px] shrink-0 items-center gap-1.5 rounded-full border border-[#d8ccb5]/70 bg-[#fffdf8]/88 px-2.5 text-[10px] font-bold leading-none text-[#314028] shadow-[inset_0_1px_2px_rgba(74,59,42,0.04)] transition-colors hover:bg-[#f3f7ed] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <TriggerIcon
            className={`h-3 w-3 shrink-0 ${isLoading || isSaving ? 'animate-spin' : ''}`}
          />
          <span className="shrink-0">{t('sessionDetail.indexTransitionLabel')}</span>
          <span className="min-w-0 truncate text-[#6f8159]">{currentOption?.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[536px] max-w-[calc(100vw-2rem)] border-[#d8ccb5]/85 bg-[#fff9ef] p-2"
      >
        <style>{transitionPreviewStyles}</style>
        <div className="ppt-index-transition-grid">
          {options.map((option) => {
            const selected = option.type === currentType
            return (
              <button
                type="button"
                key={option.type}
                data-selected={selected}
                data-transition-type={option.type}
                disabled={disabledState}
                className="ppt-index-transition-card"
                onClick={() => {
                  void handleTransitionChange(option.type)
                }}
              >
                <span className="ppt-index-transition-stage" aria-hidden="true">
                  <span className="ppt-index-transition-frame ppt-index-transition-frame-old" />
                  <span className="ppt-index-transition-frame ppt-index-transition-frame-new" />
                </span>
                <span className="ppt-index-transition-card-label">{option.label}</span>
                {selected ? (
                  <span className="ppt-index-transition-card-check" aria-hidden="true">
                    <Check className="h-3 w-3" />
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
