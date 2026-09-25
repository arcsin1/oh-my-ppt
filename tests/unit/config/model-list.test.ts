import { describe, expect, it } from 'vitest'
import {
  buildModelListRequest,
  parseModelListResponse
} from '../../../src/main/config/model-list'

describe('buildModelListRequest', () => {
  it('openai：默认官方地址，Bearer 认证', () => {
    const spec = buildModelListRequest('openai', '', 'sk-test')
    expect(spec.url).toBe('https://api.openai.com/v1/models')
    expect(spec.headers).toEqual({ Authorization: 'Bearer sk-test' })
  })

  it('openai：内网地址去掉尾斜杠后拼接 /models', () => {
    const spec = buildModelListRequest('openai', 'https://llm.corp.internal/v1/', 'key')
    expect(spec.url).toBe('https://llm.corp.internal/v1/models')
  })

  it('openai-responses：剥离 /responses 后缀再拼接', () => {
    expect(buildModelListRequest('openai-responses', 'https://llm.corp.internal/v1/responses', 'k').url).toBe(
      'https://llm.corp.internal/v1/models'
    )
    expect(buildModelListRequest('openai-responses', 'https://llm.corp.internal/v1', 'k').url).toBe(
      'https://llm.corp.internal/v1/models'
    )
  })

  it('anthropic：默认官方网关，x-api-key + 版本头', () => {
    const spec = buildModelListRequest('anthropic', '', 'sk-ant')
    expect(spec.url).toBe('https://api.anthropic.com/v1/models?limit=1000')
    expect(spec.headers).toEqual({ 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01' })
  })

  it('anthropic：内网网关拼接 /v1/models', () => {
    const spec = buildModelListRequest('anthropic', 'https://gw.corp.cn/', 'k')
    expect(spec.url).toBe('https://gw.corp.cn/v1/models?limit=1000')
  })

  it('google：默认 generativelanguage 地址，x-goog-api-key 头', () => {
    const spec = buildModelListRequest('google', '', 'g-key')
    expect(spec.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000')
    expect(spec.headers).toEqual({ 'x-goog-api-key': 'g-key' })
  })
})

describe('parseModelListResponse', () => {
  it('OpenAI/Anthropic 形状：取 data[].id，去重并排序', () => {
    const models = parseModelListResponse('openai', {
      object: 'list',
      data: [
        { id: 'deepseek-v4-flash', object: 'model' },
        { id: 'deepseek-v4-flash' },
        { id: 'glm-5.3' },
        { object: 'model' },
        null
      ]
    })
    expect(models).toEqual(['deepseek-v4-flash', 'glm-5.3'])
  })

  it('非 google 供应商缺失 id 时回退使用 name 字段', () => {
    const models = parseModelListResponse('anthropic', {
      data: [{ display_name: 'Sonnet', name: 'claude-sonnet-4-5' }]
    })
    expect(models).toEqual(['claude-sonnet-4-5'])
  })

  it('google 形状：取 models[].name 并剥离 models/ 前缀', () => {
    const models = parseModelListResponse('google', {
      models: [{ name: 'models/gemini-2.0-flash' }, { name: 'models/gemini-3.1-pro' }]
    })
    expect(models).toEqual(['gemini-2.0-flash', 'gemini-3.1-pro'])
  })

  it('结构不符合预期时抛错', () => {
    expect(() => parseModelListResponse('openai', { data: 'oops' })).toThrow()
    expect(() => parseModelListResponse('google', {})).toThrow()
    expect(() => parseModelListResponse('openai', null)).toThrow()
  })

  it('空列表返回空数组', () => {
    expect(parseModelListResponse('openai', { data: [] })).toEqual([])
  })
})
