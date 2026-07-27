export type CompanyTextProvider = 'openai' | 'openai-responses'

export const isCompanyTextProvider = (value: unknown): value is CompanyTextProvider =>
  value === 'openai' || value === 'openai-responses'

export const REDACTED_LOCAL_SECRET = '••••••••'
