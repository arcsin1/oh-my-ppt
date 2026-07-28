import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { convertDocxToMarkdown } from '../../../src/main/utils/docx-to-markdown'

const tempDirs: string[] = []

const makeTempDir = async (): Promise<string> => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'anjian-docx-runtime-'))
  tempDirs.push(dir)
  return dir
}

const writeMinimalDocx = async (filePath: string): Promise<void> => {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '</Types>'
    ].join('')
  )
  zip.file(
    '_rels/.rels',
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
      '</Relationships>'
    ].join('')
  )
  zip.file(
    'word/document.xml',
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>安居建业测试材料</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>DOCX 静态依赖入口可用</w:t></w:r></w:p>',
      '<w:sectPr/>',
      '</w:body>',
      '</w:document>'
    ].join('')
  )
  await fs.promises.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true }))
  )
})

describe('DOCX runtime imports', () => {
  it('executes the shared static mammoth and Turndown conversion used by both DOCX entries', async () => {
    const dir = await makeTempDir()
    const filePath = path.join(dir, '双入口测试.docx')
    await writeMinimalDocx(filePath)

    const markdown = await convertDocxToMarkdown(filePath)
    expect(markdown).toContain('安居建业测试材料')
    expect(markdown).toContain('DOCX 静态依赖入口可用')
  })
})
