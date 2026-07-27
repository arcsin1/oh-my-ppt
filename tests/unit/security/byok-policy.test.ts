import { describe, expect, it } from 'vitest'
import {
  getByokServicePreset,
  inferByokServiceId,
  normalizeByokBaseUrl
} from '../../../src/shared/byok'

describe('受控 BYOK 服务策略', () => {
  it('识别受支持的官方服务地址', () => {
    expect(inferByokServiceId('https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1')).toBe(
      'aliyun'
    )
    expect(inferByokServiceId('https://dashscope-intl.aliyuncs.com/compatible-mode/v1')).toBe(
      'aliyun'
    )
    expect(inferByokServiceId('https://tokenhub.tencentmaas.com/v1')).toBe('tencent')
    expect(inferByokServiceId('https://api.deepseek.com')).toBe('deepseek')
    expect(inferByokServiceId('https://ai.example.com/v1')).toBe('custom')
  })

  it('拒绝非 HTTPS、带凭据和伪造预设域名', () => {
    expect(() => normalizeByokBaseUrl('custom', 'http://ai.example.com/v1')).toThrow('HTTPS')
    expect(() => normalizeByokBaseUrl('custom', 'https://user:pass@ai.example.com/v1')).toThrow(
      '不能包含账号'
    )
    expect(() => normalizeByokBaseUrl('deepseek', 'https://deepseek.example.com/v1')).toThrow(
      '官方接口域名'
    )
  })

  it('允许经过明确选择的自定义 HTTPS OpenAI 兼容地址', () => {
    expect(normalizeByokBaseUrl('custom', ' https://ai.example.com/v1/ ')).toBe(
      'https://ai.example.com/v1'
    )
    expect(getByokServicePreset('custom').provider).toBe('openai')
    expect(getByokServicePreset('aliyun').defaultBaseUrl).toContain('dashscope.aliyuncs.com')
  })
})
