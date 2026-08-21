import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveImageGenerationProvider,
  type ResolvedImageModelConfig
} from '../../../src/main/agent-runtime/provider/image'
import { buildOpenAIImagesEndpoint } from '../../../src/main/agent-runtime/provider/image/providers/openai-images'

const adapter = resolveImageGenerationProvider('openaiImages')
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3G1wAAAABJRU5ErkJggg=='
const pngBytes = Buffer.from(pngBase64, 'base64')

const createConfig = (modelConfig: Record<string, unknown> = {}): ResolvedImageModelConfig => ({
  id: 'openai-images-config',
  name: 'OpenAI Images',
  provider: 'openaiImages',
  active: true,
  modelConfig: {
    apiKey: 'openai-key',
    model: 'gpt-image-1.5',
    ...modelConfig
  }
})

describe('OpenAI Images API provider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    ['https://api.openai.com', 'https://api.openai.com/v1/images/generations'],
    ['https://api.openai.com/', 'https://api.openai.com/v1/images/generations'],
    ['https://api.openai.com/v1', 'https://api.openai.com/v1/images/generations'],
    ['https://proxy.test/openai/v1', 'https://proxy.test/openai/v1/images/generations'],
    [
      'https://proxy.test/openai/v1/images/generations/',
      'https://proxy.test/openai/v1/images/generations'
    ]
  ])('normalizes endpoint %s', (baseUrl, expected) => {
    expect(buildOpenAIImagesEndpoint(baseUrl)).toBe(expected)
  })

  it('posts runtime inputs and configured Images API options, then reads base64 results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: pngBase64 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const results = await adapter.generate(
      createConfig({
        baseUrl: 'https://api.openai.com/v1',
        quality: 'medium',
        output_format: 'png',
        background: 'transparent',
        moderation: 'auto',
        headers: { 'x-team': 'slides' },
        modelKwargs: { n: 99, size: 'auto', prompt: 'wrong', user: 'deck-user' }
      }),
      { prompt: 'presentation hero', size: '1536x1024', count: 2 }
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(endpoint).toBe('https://api.openai.com/v1/images/generations')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer openai-key',
      'content-type': 'application/json',
      'x-team': 'slides'
    })
    expect(JSON.parse(String(init.body))).toEqual({
      n: 2,
      size: '1536x1024',
      prompt: 'presentation hero',
      user: 'deck-user',
      quality: 'medium',
      output_format: 'png',
      background: 'transparent',
      moderation: 'auto',
      model: 'gpt-image-1.5'
    })
    expect(results).toHaveLength(1)
    expect(results[0].bytes.length).toBeGreaterThan(0)
    expect(results[0].mimeType).toBe('image/png')
  })

  it('uses output_format metadata for base64 results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: pngBase64 }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const results = await adapter.generate(createConfig({ output_format: 'webp' }), {
      prompt: 'presentation visual',
      size: '1024x1024',
      count: 1
    })

    expect(results[0]).toMatchObject({ mimeType: 'image/webp', extension: '.webp' })
  })

  it('uses an explicit endpoint and downloads url results', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ url: 'https://assets.test/image.png' }] }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } })
      )
    vi.stubGlobal('fetch', fetchMock)

    const results = await adapter.generate(
      createConfig({ endpoint: 'https://gateway.test/generate', api_key: 'fallback-key', apiKey: '' }),
      { prompt: 'visual', size: '1024x1024', count: 1 }
    )

    expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.test/generate')
    expect(fetchMock.mock.calls[1][0]).toBe('https://assets.test/image.png')
    expect(results[0].bytes.equals(pngBytes)).toBe(true)
  })

  it('reports protocol errors for failed, invalid, and empty responses', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'unsupported size' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    )
    await expect(
      adapter.generate(createConfig(), { prompt: 'visual', size: '1x1', count: 1 })
    ).rejects.toThrow('OpenAI Images API failed (400')

    fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 200 }))
    await expect(
      adapter.generate(createConfig(), { prompt: 'visual', size: 'auto', count: 1 })
    ).rejects.toThrow('OpenAI Images API returned invalid JSON')

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
    await expect(
      adapter.generate(createConfig(), { prompt: 'visual', size: 'auto', count: 1 })
    ).rejects.toThrow('OpenAI Images API returned no images')
  })

  it('passes the abort signal to the generation request', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      adapter.generate(createConfig(), {
        prompt: 'visual',
        size: 'auto',
        count: 1,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })
})
