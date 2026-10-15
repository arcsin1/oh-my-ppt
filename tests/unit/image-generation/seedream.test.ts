import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveImageGenerationProvider,
  type ResolvedImageModelConfig
} from '../../../src/main/agent-runtime/provider/image'

const seedreamAdapter = resolveImageGenerationProvider('seedream')

const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3G1wAAAABJRU5ErkJggg=='
const pngBytes = Buffer.from(pngBase64, 'base64')

const createConfig = (
  modelConfig: Record<string, unknown> = {}
): ResolvedImageModelConfig => ({
  id: 'seedream-config',
  name: 'Seedream',
  provider: 'seedream',
  active: true,
  modelConfig: {
    apiKey: 'ark-key',
    model: 'doubao-seedream-5-0-260128',
    ...modelConfig
  }
})

describe('seedream image generation provider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('posts an Ark image generation request and reads base64 images', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ b64_json: pngBase64 }]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const results = await seedreamAdapter.generate(
      createConfig({ response_format: 'b64_json', sizes: ['1K', '2K', '4K'] }),
      {
        prompt: 'a clean presentation background',
        size: '2K',
        count: 1,
        negativePrompt: 'low quality',
        seed: 42
      }
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(endpoint).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer ark-key',
      'content-type': 'application/json'
    })
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({
      model: 'doubao-seedream-5-0-260128',
      prompt: 'a clean presentation background',
      size: '2K',
      n: 1,
      response_format: 'b64_json',
      negative_prompt: 'low quality',
      seed: 42
    })
    // 回归：sequential_image_generation / stream 未配置时不得被兜底补回，
    // 否则第三方中转网关会以"不支持该参数"拒绝请求。
    expect(body).not.toHaveProperty('sequential_image_generation')
    expect(body).not.toHaveProperty('stream')
    expect(body).not.toHaveProperty('sizes')
    expect(results).toHaveLength(1)
    expect(results[0].mimeType).toBe('image/png')
    expect(results[0].extension).toBe('.png')
    expect(results[0].bytes.length).toBeGreaterThan(0)
  })

  it('downloads images from Seedream url results and ignores returned size metadata', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'doubao-seedream-5-0-260128',
            created: 1757321139,
            data: [
              {
                url: 'https://example.test/seedream.png',
                size: '3104x1312'
              }
            ],
            usage: {
              generated_images: 1,
              output_tokens: 10,
              total_tokens: 10
            }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(pngBytes, {
          status: 200,
          headers: { 'content-type': 'image/png' }
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const results = await seedreamAdapter.generate(createConfig(), {
      prompt: 'hero image',
      size: '2K',
      count: 1
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.test/seedream.png')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      response_format: 'url',
      size: '2K'
    })
    expect(results).toHaveLength(1)
    expect(results[0].mimeType).toBe('image/png')
    expect(results[0].bytes.equals(pngBytes)).toBe(true)
  })

  it('allows endpoint, headers, and request body overrides from model config', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: pngBase64 }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    await seedreamAdapter.generate(
      createConfig({
        endpoint: 'https://example.test/images',
        headers: { 'x-team': 'slides' },
        requestBody: { watermark: true, size: '2048x2048' }
      }),
      {
        prompt: 'hero image',
        size: '1:1',
        count: 2
      }
    )

    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(endpoint).toBe('https://example.test/images')
    expect(init.headers).toMatchObject({ 'x-team': 'slides' })
    expect(JSON.parse(String(init.body))).toMatchObject({
      size: '2048x2048',
      n: 2,
      watermark: true
    })
  })

  it('sends sequential_image_generation and stream only when explicitly configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: pngBase64 }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    await seedreamAdapter.generate(
      createConfig({ sequential_image_generation: 'auto', stream: true }),
      {
        prompt: 'hero image',
        size: '2K',
        count: 1
      }
    )

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      sequential_image_generation: 'auto',
      stream: true
    })
  })

  it('treats baseUrl with a path as the full endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: pngBase64 }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    await seedreamAdapter.generate(
      createConfig({
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
        model: 'doubao-seedream-4-5-251128'
      }),
      {
        prompt: 'hero image',
        size: '1:1',
        count: 1
      }
    )

    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(endpoint).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'doubao-seedream-4-5-251128'
    })
  })
})
