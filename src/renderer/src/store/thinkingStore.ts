import { create } from 'zustand'
import { ipc } from '@renderer/lib/ipc'
import type {
  ThinkingStage,
  ThinkingSource,
  ThinkingChatMessage,
  ThinkingPageOutlineUpdate
} from '@shared/thinking'

interface ThinkingStep {
  type: 'tool_call' | 'tool_result'
  toolName: string
  summary: string
}

interface ThinkingStore {
  thinkingId: string | null
  stage: ThinkingStage
  thinkingMd: string
  contextMd: string
  sources: ThinkingSource[]
  messages: ThinkingChatMessage[]
  thinkingSteps: ThinkingStep[]
  animatingText: string
  loading: boolean
  error: string | null

  createWorkspace: () => Promise<string>
  loadWorkspace: (thinkingId: string) => Promise<void>
  loadLatestWorkspace: () => Promise<string | null>
  refreshWorkspace: (thinkingId?: string) => Promise<boolean>
  updatePageOutline: (page: ThinkingPageOutlineUpdate) => Promise<void>
  addMessage: (message: ThinkingChatMessage) => void
  sendMessage: (content: string, attachments?: ThinkingSource[], modelConfigId?: string) => void
  addThinkingStep: (step: ThinkingStep) => void
  setAnimatingText: (text: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  reset: () => void
}

let streamListenersReady = false

const readStoredLocale = (): 'zh' | 'en' => {
  if (typeof window === 'undefined') return 'zh'
  return window.localStorage.getItem('oh-my-ppt:lang') === 'en' ? 'en' : 'zh'
}

function formatChatFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '')
  const compactMessage = message.trim().replace(/\s+/g, ' ').slice(0, 500)
  if (readStoredLocale() === 'en') {
    return [
      'LLM reply failed. Please try again.',
      compactMessage ? `Error: ${compactMessage}` : ''
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  return [
    'LLM 回复失败了，请重试一次。',
    compactMessage ? `错误：${compactMessage}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

function hasAssistantReply(messages: ThinkingChatMessage[], reply: string): boolean {
  const normalized = reply.trim()
  if (!normalized) return false
  return messages.some((message) => message.role === 'assistant' && message.content.trim() === normalized)
}

function ensureThinkingStreamListeners(
  set: (
    partial:
      | Partial<ThinkingStore>
      | ((state: ThinkingStore) => Partial<ThinkingStore> | ThinkingStore)
  ) => void,
  get: () => ThinkingStore
): void {
  if (streamListenersReady) return
  streamListenersReady = true

  ipc.onThinkingStreamThinking((payload) => {
    const state = get()
    if (payload.thinkingId !== state.thinkingId) return
    state.addThinkingStep({
      type: payload.type as 'tool_call' | 'tool_result',
      toolName: payload.toolName,
      summary: payload.summary
    })
  })

  ipc.onThinkingStreamEnd((payload) => {
    const state = get()
    if (payload.thinkingId !== state.thinkingId) return

    set({
      thinkingMd: payload.thinkingMd,
      contextMd: payload.contextMd,
      stage: payload.stage
    })
    void get().refreshWorkspace(payload.thinkingId)

    const fullText = payload.reply.trim()
    if (!fullText || hasAssistantReply(get().messages, fullText)) {
      set({ loading: false, thinkingSteps: [], animatingText: '' })
      return
    }

    let index = 0
    const charsPerTick = 3
    const tickMs = 20
    const animate = (): void => {
      const current = get()
      if (!current.loading || current.thinkingId !== payload.thinkingId) return
      index = Math.min(index + charsPerTick, fullText.length)
      current.setAnimatingText(fullText.slice(0, index))
      if (index < fullText.length) {
        setTimeout(animate, tickMs)
      } else {
        if (!hasAssistantReply(get().messages, fullText)) {
          current.addMessage({
            role: 'assistant',
            content: fullText,
            timestamp: Date.now()
          })
        }
        set({
          loading: false,
          thinkingSteps: [],
          animatingText: ''
        })
      }
    }
    animate()
  })
}

export const useThinkingStore = create<ThinkingStore>((set, get) => {
  return {
    thinkingId: null,
    stage: 'collect',
    thinkingMd: '',
    contextMd: '',
    sources: [],
    messages: [],
    thinkingSteps: [],
    animatingText: '',
    loading: false,
    error: null,

    createWorkspace: async () => {
    ensureThinkingStreamListeners(set, get)
    set({
      thinkingId: null,
      stage: 'collect',
      thinkingMd: '',
      contextMd: '',
      sources: [],
      messages: [],
      thinkingSteps: [],
      animatingText: '',
      loading: true,
      error: null
    })
    try {
      const workspace = await ipc.thinkingCreateWorkspace()
      set({
        thinkingId: workspace.thinkingId,
        stage: workspace.stage,
        thinkingMd: workspace.thinkingMd,
        contextMd: workspace.contextMd,
        sources: workspace.sources,
        messages: workspace.messages,
        thinkingSteps: [],
        animatingText: '',
        loading: false
      })
      return workspace.thinkingId
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to create workspace',
        loading: false
      })
      throw err
    }
    },

    loadWorkspace: async (thinkingId) => {
    ensureThinkingStreamListeners(set, get)
    set({
      thinkingId,
      stage: 'collect',
      thinkingMd: '',
      contextMd: '',
      sources: [],
      messages: [],
      thinkingSteps: [],
      animatingText: '',
      loading: true,
      error: null
    })
    try {
      const workspace = await ipc.thinkingGetWorkspace(thinkingId)
      set({
        thinkingId: workspace.thinkingId,
        stage: workspace.stage,
        thinkingMd: workspace.thinkingMd,
        contextMd: workspace.contextMd,
        sources: workspace.sources,
        messages: workspace.messages,
        thinkingSteps: [],
        animatingText: '',
        loading: false
      })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load workspace',
        loading: false
      })
    }
    },

    loadLatestWorkspace: async () => {
    ensureThinkingStreamListeners(set, get)
    try {
      const result = await ipc.thinkingGetLatestWorkspace()
      if (!result) return null
      set({
        thinkingId: result.thinkingId,
        stage: result.stage,
        thinkingMd: result.thinkingMd,
        contextMd: result.contextMd,
        sources: result.sources,
        messages: result.messages,
        thinkingSteps: [],
        animatingText: '',
        loading: false
      })
      return result.thinkingId
    } catch {
      return null
    }
    },

    refreshWorkspace: async (thinkingId) => {
    const activeThinkingId = thinkingId || get().thinkingId
    if (!activeThinkingId) return false

    const workspace = await ipc.thinkingGetWorkspace(activeThinkingId)
    const current = get()
    if (current.thinkingId !== activeThinkingId || workspace.thinkingId !== activeThinkingId) {
      return false
    }

    const sourcesChanged = JSON.stringify(current.sources) !== JSON.stringify(workspace.sources)
    const messagesChanged =
      !current.loading && JSON.stringify(current.messages) !== JSON.stringify(workspace.messages)
    const changed =
      current.thinkingMd !== workspace.thinkingMd ||
      current.contextMd !== workspace.contextMd ||
      current.stage !== workspace.stage ||
      sourcesChanged ||
      messagesChanged

    set({
      thinkingMd: workspace.thinkingMd,
      contextMd: workspace.contextMd,
      stage: workspace.stage,
      sources: workspace.sources,
      ...(current.loading ? {} : { messages: workspace.messages })
    })

    return changed
    },

    updatePageOutline: async (page) => {
    const { thinkingId, loading } = get()
    if (!thinkingId) throw new Error('Thinking workspace is not ready')
    if (loading) throw new Error('Thinking workspace is busy')
    const result = await ipc.thinkingUpdatePageOutline({ thinkingId, page })
    set((state) =>
      state.thinkingId === thinkingId
        ? {
            thinkingMd: result.thinkingMd
          }
        : state
    )
    },

    addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

    addThinkingStep: (step) =>
    set((state) => {
      const summary = step.summary.trim()
      if (!summary || step.type === 'tool_result') return state

      const lastStep = state.thinkingSteps[state.thinkingSteps.length - 1]
      if (lastStep && lastStep.summary === summary) return state

      const alreadyRecent = state.thinkingSteps
        .slice(-3)
        .some((item) => item.summary === summary && item.toolName === step.toolName)
      if (alreadyRecent) return state

      return {
        thinkingSteps: [
          ...state.thinkingSteps,
          {
            ...step,
            summary
          }
        ].slice(-6)
      }
    }),

    setAnimatingText: (text) =>
    set({ animatingText: text }),

    sendMessage: (content, attachments, modelConfigId) => {
    ensureThinkingStreamListeners(set, get)
    const { thinkingId, messages } = get()
    if (!thinkingId) return
    const recentMessages = messages.slice(-8)

    get().addMessage({
      role: 'user',
      content,
      timestamp: Date.now(),
      ...(attachments && attachments.length > 0 ? { attachments } : {})
    })

    set({ loading: true, error: null, thinkingSteps: [], animatingText: '' })

    // Fire-and-forget: the IPC call returns the full result,
    // but we show thinking events and animate the reply via stream listeners.
    ipc.thinkingChat({
      thinkingId,
      modelConfigId,
      userMessage: content,
      recentMessages,
      ...(attachments && attachments.length > 0 ? { attachments } : {})
    }).catch((err) => {
      const errorMessage = err instanceof Error ? err.message : 'Chat failed'
      set((state) => {
        if (state.thinkingId !== thinkingId) return state
        return {
          error: errorMessage,
          animatingText: '',
          loading: false,
          thinkingSteps: [],
          messages: [
            ...state.messages,
            {
              role: 'assistant',
              content: formatChatFailureMessage(err),
              timestamp: Date.now()
            }
          ]
        }
      })
    })
    },

    setLoading: (loading) => set({ loading }),
    setError: (error) => set({ error }),

    reset: () =>
    set({
      thinkingId: null,
      stage: 'collect',
      thinkingMd: '',
      contextMd: '',
      sources: [],
      messages: [],
      thinkingSteps: [],
      animatingText: '',
      loading: false,
      error: null
    })
  }
})
