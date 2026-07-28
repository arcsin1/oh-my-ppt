declare module 'mammoth' {
  export type MammothMessage = {
    message: string
  }

  export type MammothResult = {
    value: string
    messages: MammothMessage[]
  }

  export function convertToHtml(input: { path: string }): Promise<MammothResult>
}

declare module 'turndown' {
  export default class TurndownService {
    constructor(options?: Record<string, unknown>)
    use(plugin: unknown): this
    turndown(html: string): string
  }
}

declare module '@joplin/turndown-plugin-gfm' {
  export const gfm: unknown
}

declare module 'papaparse' {
  type ParseResult = {
    data: unknown[][]
    errors?: Array<{ message?: string }>
  }

  const Papa: {
    parse(input: string, options: Record<string, unknown>): ParseResult
  }

  export default Papa
}
