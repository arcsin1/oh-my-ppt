import fs from 'fs/promises'
import path from 'path'
import * as XLSX from 'xlsx'

const escapeMarkdownCell = (value: unknown): string =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim()

const normalizeCell = (cell: XLSX.CellObject | undefined): string => {
  if (!cell) return ''
  if (cell.v instanceof Date && !Number.isNaN(cell.v.getTime())) {
    return cell.v.toISOString().slice(0, 10)
  }
  if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
    const date = XLSX.SSF.parse_date_code(Number(cell.v))
    if (date) {
      return `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(
        date.d
      ).padStart(2, '0')}`
    }
  }
  return escapeMarkdownCell(cell.v)
}

const worksheetRows = (worksheet: XLSX.WorkSheet): string[][] => {
  if (!worksheet['!ref']) return []
  const range = XLSX.utils.decode_range(worksheet['!ref'])
  const rows: string[][] = []
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row: string[] = []
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      row.push(normalizeCell(worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })]))
    }
    if (row.some((cell) => cell.length > 0)) rows.push(row)
  }
  return rows
}

const rowsToMarkdownTable = (rows: string[][]): string => {
  const columnCount = Math.max(...rows.map((row) => row.length))
  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] || '')
  )
  const header = normalizedRows[0]
  const body = normalizedRows.slice(1)
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`)
  ].join('\n')
}

export const convertWorkbookToMarkdown = (workbook: XLSX.WorkBook, title: string): string => {
  const sections = workbook.SheetNames.flatMap((sheetName) => {
    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet) return []
    const rows = worksheetRows(worksheet)
    if (rows.length === 0) return []
    return [`## 工作表：${sheetName}`, '', rowsToMarkdownTable(rows), '']
  })
  if (sections.length === 0) throw new Error(`${title} 工作簿没有可读取的非空单元格`)
  return [`# ${title}`, '', ...sections].join('\n').trim()
}

const readErrorCode = (error: unknown): string =>
  error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '').toUpperCase()
    : ''

export const describeExcelReadError = (filePath: string, error: unknown): string => {
  const fileName = path.basename(filePath) || 'Excel 文件'
  const code = readErrorCode(error)
  if (code === 'ENOENT') return `Excel 文件不存在或已移动：${fileName}`
  if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') {
    return `无法读取 Excel 文件，请关闭占用该文件的程序并检查访问权限：${fileName}`
  }
  return `Excel 文件可能已损坏、加密或格式不受支持：${fileName}`
}

export const convertExcelFileToMarkdown = async (
  filePath: string,
  title?: string
): Promise<string> => {
  let fileBuffer: Buffer
  try {
    fileBuffer = await fs.readFile(filePath)
  } catch (error) {
    throw new Error(describeExcelReadError(filePath, error))
  }

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(fileBuffer, {
      type: 'buffer',
      cellDates: true,
      raw: false
    })
  } catch (error) {
    throw new Error(describeExcelReadError(filePath, error))
  }

  return convertWorkbookToMarkdown(
    workbook,
    title?.trim() || path.basename(filePath, path.extname(filePath)) || 'Excel 参考资料'
  )
}
