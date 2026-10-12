// ppt/fonts/fontN.fntdata 的容器格式。
// 实测矩阵（第四轮字体嵌入实验，2026-10）：
// - 裸 TTF（sfnt）：PowerPoint for Mac 16.78 正常（EOT 会丢加粗）；WPS 12.1.0.28505
//   不解析（含 Google 原版 TTF，直接回退宋体）
// - EOT 容器：WPS 12.1.0.28505 正常；PowerPoint for Mac 16.78 加粗丢失
// 两类查看器互斥，因此做成导出设置项，默认取覆盖面更广的裸 TTF。
export type FontPayloadFormat = 'ttf' | 'eot'

export const DEFAULT_FONT_PAYLOAD_FORMAT: FontPayloadFormat = 'ttf'

export const isFontPayloadFormat = (value: unknown): value is FontPayloadFormat =>
  value === 'ttf' || value === 'eot'

export const parseFontPayloadFormat = (value: unknown): FontPayloadFormat =>
  isFontPayloadFormat(value) ? value : DEFAULT_FONT_PAYLOAD_FORMAT
