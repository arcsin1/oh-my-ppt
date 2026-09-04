import fs from 'fs'

export type PageHtmlSnapshot = {
  restore: () => Promise<void>
}

export const capturePageHtmlSnapshot = async (htmlPath: string): Promise<PageHtmlSnapshot> => {
  try {
    const html = await fs.promises.readFile(htmlPath, 'utf-8')
    return {
      restore: async () => {
        await fs.promises.writeFile(htmlPath, html, 'utf-8')
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return {
      restore: async () => {
        await fs.promises.rm(htmlPath, { force: true })
      }
    }
  }
}
