import { describe, expect, it } from 'vitest'
import {
  buildOpenAIModelOptions,
  buildOrcaRouterModelOptions,
  normalizeOpenAIBaseUrl,
  ORCAROUTER_BASE_URL,
  ORCAROUTER_DEFAULT_MODEL,
  resolveOpenAIThinkingModelKwargs
} from '../../src/main/agent-runtime/model'

describe('buildOrcaRouterModelOptions', () => {
  it('defaults to the OrcaRouter gateway endpoint and model alias', () => {
    expect(
      buildOrcaRouterModelOptions({
        model: ORCAROUTER_DEFAULT_MODEL,
        apiKey: 'secret',
        temperatureOptions: { temperature: 0.7 },
        maxTokens: 4096
      })
    ).toEqual({
      model: 'orcarouter/auto',
      apiKey: 'secret',
      temperature: 0.7,
      maxTokens: 4096,
      configuration: { baseURL: 'https://api.orcarouter.ai/v1' },
      modelKwargs: { thinking: { type: 'disabled' } }
    })
  })

  it('honors an explicit base_url override', () => {
    expect(
      buildOrcaRouterModelOptions({
        model: 'orcarouter/auto',
        apiKey: 'secret',
        baseUrl: 'https://gateway.example.com/v1/',
        temperatureOptions: {},
        maxTokens: 2048
      })
    ).toEqual({
      model: 'orcarouter/auto',
      apiKey: 'secret',
      maxTokens: 2048,
      configuration: { baseURL: 'https://gateway.example.com/v1' },
      modelKwargs: { thinking: { type: 'disabled' } }
    })
  })

  it('exposes the official gateway constant', () => {
    expect(ORCAROUTER_BASE_URL).toBe('https://api.orcarouter.ai/v1')
    expect(ORCAROUTER_DEFAULT_MODEL).toBe('orcarouter/auto')
  })
})

describe('buildOpenAIModelOptions', () => {
  it.each(['', 'https://api.openai.com', 'https://api.openai.com/v1', 'https://API.OPENAI.COM/v1/'])(
    'does not inject compatibility thinking parameters for official OpenAI: %s',
    (baseUrl) => {
      const options = buildOpenAIModelOptions({
        model: 'test-model',
        apiKey: 'secret',
        baseUrl,
        temperatureOptions: { temperature: 0.7 },
        maxTokens: 4096
      })

      expect(options).toEqual({
        model: 'test-model',
        apiKey: 'secret',
        temperature: 0.7,
        maxTokens: 4096,
        configuration: baseUrl ? { baseURL: baseUrl.replace(/\/+$/, '') } : undefined,
        modelKwargs: {}
      })
    }
  )

  it('keeps thinking disabled for custom OpenAI-compatible endpoints', () => {
    expect(
      buildOpenAIModelOptions({
        model: 'test-model',
        apiKey: 'secret',
        baseUrl: 'https://api.example-compatible.com/v1',
        temperatureOptions: {},
        maxTokens: 2048
      })
    ).toEqual({
      model: 'test-model',
      apiKey: 'secret',
      maxTokens: 2048,
      configuration: { baseURL: 'https://api.example-compatible.com/v1' },
      modelKwargs: { thinking: { type: 'disabled' } }
    })
  })

  it('omits thinking parameters for custom endpoints when configured', () => {
    expect(
      buildOpenAIModelOptions({
        model: 'test-model',
        apiKey: 'secret',
        baseUrl: 'https://api.example-compatible.com/v1',
        temperatureOptions: {},
        maxTokens: 2048,
        thinkingParameterMode: 'omit'
      })
    ).toEqual({
      model: 'test-model',
      apiKey: 'secret',
      maxTokens: 2048,
      configuration: { baseURL: 'https://api.example-compatible.com/v1' },
      modelKwargs: {}
    })
  })

  it('does not inject Chat Completions compatibility kwargs for Responses API models', () => {
    expect(
      buildOpenAIModelOptions({
        model: 'gpt-5.1',
        apiKey: 'secret',
        baseUrl: 'https://api.example-compatible.com/v1',
        temperatureOptions: {},
        maxTokens: 2048,
        useResponsesApi: true
      })
    ).toEqual({
      model: 'gpt-5.1',
      apiKey: 'secret',
      maxTokens: 2048,
      configuration: { baseURL: 'https://api.example-compatible.com/v1' },
      modelKwargs: {}
    })
  })

  it('normalizes accidental /responses suffix only for Responses API models', () => {
    expect(normalizeOpenAIBaseUrl('https://api.example.com/v1/responses', true)).toBe(
      'https://api.example.com/v1'
    )
    expect(normalizeOpenAIBaseUrl('https://api.example.com/v1/responses/', true)).toBe(
      'https://api.example.com/v1'
    )
    expect(normalizeOpenAIBaseUrl('https://api.example.com/v1/responses', false)).toBe(
      'https://api.example.com/v1/responses'
    )
  })

  it('centralizes thinking model kwargs resolution', () => {
    expect(
      resolveOpenAIThinkingModelKwargs({
        baseUrl: 'https://api.example-compatible.com/v1',
        thinkingParameterMode: 'auto'
      })
    ).toEqual({ thinking: { type: 'disabled' } })
    expect(
      resolveOpenAIThinkingModelKwargs({
        baseUrl: 'https://api.example-compatible.com/v1',
        thinkingParameterMode: 'omit'
      })
    ).toEqual({})
  })
})
