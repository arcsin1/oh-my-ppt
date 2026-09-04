type StyleImageSection = {
  basePrompt: string
  styleGuidance: string
}

export const splitStyleImageSection = (styleSkillPrompt: string): StyleImageSection => {
  const lines = styleSkillPrompt.trim().split(/\r?\n/)
  const start = lines.findIndex((line) => /^##\s*配图\s*$/.test(line.trim()))
  if (start < 0) return { basePrompt: styleSkillPrompt.trim(), styleGuidance: '' }

  let end = start + 1
  while (end < lines.length && !/^##\s+/.test(lines[end].trim())) end += 1
  const basePrompt = [...lines.slice(0, start), ...lines.slice(end)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return {
    basePrompt,
    styleGuidance: lines.slice(start + 1, end).join('\n').trim()
  }
}

export const buildStyleImageGuidance = (args: {
  visualEnabled: boolean
  imageGenerationPrompt?: string | null
  styleGuidance?: string
}): string => {
  const imageDirection = args.imageGenerationPrompt?.trim()
  if (!args.visualEnabled || !imageDirection) return ''

  return [
    '## 配图',
    args.styleGuidance?.trim() || ''
  ]
    .filter(Boolean)
    .join('\n')
}

export const appendStyleImageGuidance = (
  styleSkillPrompt: string,
  args: {
    visualEnabled: boolean
    imageGenerationPrompt?: string | null
  }
): string => {
  const { basePrompt, styleGuidance } = splitStyleImageSection(styleSkillPrompt)
  const guidance = buildStyleImageGuidance({ ...args, styleGuidance })
  return guidance ? `${basePrompt}\n\n${guidance}` : basePrompt
}
