import { randomUUID } from 'node:crypto'

export const ENCRYPTED_CREDENTIAL_PREFIX = 'enc:v1:'
export const SESSION_CREDENTIAL_PREFIX = 'session:v1:'

export interface SafeStorageAdapter {
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

export interface CredentialStorageLogger {
  warn?: (message: string, meta?: Record<string, unknown>) => void
  error?: (message: string, meta?: Record<string, unknown>) => void
}

export interface CredentialCodec {
  encrypt: (value: string) => string
  decrypt: (rawValue: unknown) => string
}

export interface CredentialCodecOptions {
  allowSessionOnly?: boolean
}

export const isSessionCredentialReference = (value: unknown): boolean =>
  typeof value === 'string' && value.startsWith(SESSION_CREDENTIAL_PREFIX)

export function createCredentialCodec(
  safeStorage: SafeStorageAdapter,
  logger?: CredentialStorageLogger,
  options: CredentialCodecOptions = {}
): CredentialCodec {
  const sessionCredentials = new Map<string, string>()

  const createSessionReference = (value: string): string => {
    const reference = `${SESSION_CREDENTIAL_PREFIX}${randomUUID()}`
    sessionCredentials.set(reference, value)
    logger?.warn?.('[security] using memory-only credential for current process')
    return reference
  }

  const encrypt = (value: string): string => {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (!safeStorage.isEncryptionAvailable()) {
      if (options.allowSessionOnly) return createSessionReference(trimmed)
      logger?.error?.('[security] secure credential storage unavailable')
      throw new Error('系统安全存储不可用，个人 API Key 未保存。请检查 Windows 登录状态后重试。')
    }
    try {
      const encrypted = safeStorage.encryptString(trimmed).toString('base64')
      return `${ENCRYPTED_CREDENTIAL_PREFIX}${encrypted}`
    } catch (error) {
      logger?.error?.('[security] credential encryption failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      throw new Error('API Key 加密失败，个人 API Key 未保存。请检查系统安全存储后重试。')
    }
  }

  const decrypt = (rawValue: unknown): string => {
    if (typeof rawValue !== 'string') return ''
    const raw = rawValue.trim()
    if (!raw) return ''
    if (isSessionCredentialReference(raw)) return sessionCredentials.get(raw) || ''
    if (!raw.startsWith(ENCRYPTED_CREDENTIAL_PREFIX)) {
      logger?.warn?.('[security] rejected legacy plaintext credential')
      return ''
    }
    if (!safeStorage.isEncryptionAvailable()) {
      logger?.warn?.('[security] secure credential storage unavailable during decrypt')
      return ''
    }
    try {
      const encrypted = raw.slice(ENCRYPTED_CREDENTIAL_PREFIX.length)
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch (error) {
      logger?.error?.('[security] credential decryption failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      return ''
    }
  }

  return { encrypt, decrypt }
}
