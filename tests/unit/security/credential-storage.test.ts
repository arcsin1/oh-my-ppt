import { describe, expect, it, vi } from 'vitest'
import {
  createCredentialCodec,
  ENCRYPTED_CREDENTIAL_PREFIX,
  SESSION_CREDENTIAL_PREFIX
} from '../../../src/main/security/credential-storage'

const createSafeStorage = (available = true) => ({
  isEncryptionAvailable: vi.fn(() => available),
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`, 'utf8')),
  decryptString: vi.fn((value: Buffer) =>
    value.toString('utf8').replace(/^encrypted:/, '')
  )
})

describe('credential storage', () => {
  it('encrypts and decrypts credentials with the operating-system secure store', () => {
    const safeStorage = createSafeStorage()
    const codec = createCredentialCodec(safeStorage)

    const encrypted = codec.encrypt('  personal-key  ')

    expect(encrypted).toMatch(new RegExp(`^${ENCRYPTED_CREDENTIAL_PREFIX}`))
    expect(encrypted).not.toContain('personal-key')
    expect(codec.decrypt(encrypted)).toBe('personal-key')
  })

  it('fails closed instead of storing plaintext when secure storage is unavailable', () => {
    const safeStorage = createSafeStorage(false)
    const codec = createCredentialCodec(safeStorage)

    expect(() => codec.encrypt('personal-key')).toThrow('系统安全存储不可用')
    expect(safeStorage.encryptString).not.toHaveBeenCalled()
  })

  it('keeps a credential in memory only when session fallback is explicitly enabled', () => {
    const safeStorage = createSafeStorage(false)
    const codec = createCredentialCodec(safeStorage, undefined, {
      allowSessionOnly: true
    })

    const reference = codec.encrypt('personal-key')

    expect(reference).toMatch(new RegExp(`^${SESSION_CREDENTIAL_PREFIX}`))
    expect(reference).not.toContain('personal-key')
    expect(codec.decrypt(reference)).toBe('personal-key')
    expect(safeStorage.encryptString).not.toHaveBeenCalled()

    const restartedCodec = createCredentialCodec(safeStorage, undefined, {
      allowSessionOnly: true
    })
    expect(restartedCodec.decrypt(reference)).toBe('')
  })

  it('rejects legacy plaintext credentials', () => {
    const logger = { warn: vi.fn(), error: vi.fn() }
    const codec = createCredentialCodec(createSafeStorage(), logger)

    expect(codec.decrypt('legacy-plaintext-key')).toBe('')
    expect(logger.warn).toHaveBeenCalledWith(
      '[security] rejected legacy plaintext credential'
    )
  })

  it('does not decrypt encrypted credentials when secure storage is unavailable', () => {
    const safeStorage = createSafeStorage(false)
    const codec = createCredentialCodec(safeStorage)

    expect(codec.decrypt(`${ENCRYPTED_CREDENTIAL_PREFIX}ZW5jcnlwdGVkOnNlY3JldA==`)).toBe('')
    expect(safeStorage.decryptString).not.toHaveBeenCalled()
  })
})
