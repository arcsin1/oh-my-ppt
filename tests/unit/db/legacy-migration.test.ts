import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@libsql/client'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), 'ohmyppt-test-user-data'))
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true }
}))

import { PPTDatabase } from '../../../src/main/db/database'
import { migrateLegacyProdDatabase } from '../../../src/main/db/legacy-migration'

const SETTINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`

const MODEL_CONFIGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS model_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  max_tokens INTEGER NOT NULL DEFAULT 4096,
  active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`

const createLegacyDatabase = async (legacyPath: string): Promise<void> => {
  const legacy = createClient({ url: `file:${legacyPath}` })
  await legacy.execute(SETTINGS_TABLE_SQL)
  await legacy.execute(MODEL_CONFIGS_TABLE_SQL)
  await legacy.execute({
    sql: 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
    args: ['proxy_url', '"http://192.168.31.172:808"', 1791700000]
  })
  await legacy.execute({
    sql: 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
    args: ['proxy_bypass', '"localhost,127.0.0.1"', 1791700000]
  })
  await legacy.execute({
    sql: 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
    args: ['timeout_ms_agent', '1200000', 1791700000]
  })
  await legacy.execute({
    sql: `INSERT INTO model_configs
            (id, name, provider, model, api_key, base_url, max_tokens, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      'legacy-model-id',
      'centerm',
      'openai',
      'lite-pool',
      'enc:v1:ciphertext',
      'http://10.17.70.13:19530/v1',
      128000,
      1,
      1791700000,
      1791700000
    ]
  })
  await legacy.close()
}

describe('legacy ohmyppt-prod.db migration', () => {
  const roots: string[] = []

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('restores settings and model configs into an empty database', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-legacy-migration-'))
    roots.push(root)
    await createLegacyDatabase(path.join(root, 'ohmyppt-prod.db'))

    const db = new PPTDatabase(path.join(root, 'ohmyppt.db'))
    await db.init()

    try {
      await expect(db.getSetting<string>('timeout_ms_agent')).resolves.toBe(1200000)
      // proxy_bypass 更名为 proxy_no_proxy 后恢复
      await expect(db.getSetting<string>('proxy_no_proxy')).resolves.toBe('localhost,127.0.0.1')
      const modelConfigs = await db.listModelConfigs()
      expect(modelConfigs).toHaveLength(1)
      expect(modelConfigs[0]).toMatchObject({
        name: 'centerm',
        provider: 'openai',
        model: 'lite-pool',
        apiKey: 'enc:v1:ciphertext',
        maxTokens: 128000,
        active: 1
      })
    } finally {
      await db.close()
    }
  })

  it('does not overwrite newer values already present in the current database', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-legacy-migration-'))
    roots.push(root)
    await createLegacyDatabase(path.join(root, 'ohmyppt-prod.db'))

    // 预置新库：proxy_url 已有新值、proxy_no_proxy 为空字符串
    const current = createClient({ url: `file:${path.join(root, 'ohmyppt.db')}` })
    await current.execute(SETTINGS_TABLE_SQL)
    await current.execute(MODEL_CONFIGS_TABLE_SQL)
    await current.execute({
      sql: 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
      args: ['proxy_url', '"http://new-proxy:808"', 1791800000]
    })
    await current.execute({
      sql: 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
      args: ['proxy_no_proxy', '""', 1791800000]
    })
    await current.execute({
      sql: `INSERT INTO model_configs
              (id, name, provider, model, api_key, base_url, max_tokens, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['new-model-id', 'Centerm', 'openai', 'lite-pool', 'enc:v1:new', '', 4096, 1, 1791800000, 1791800000]
    })
    await current.close()

    const db = new PPTDatabase(path.join(root, 'ohmyppt.db'))
    await db.init()

    try {
      // 新库已有非空值 → 保留
      await expect(db.getSetting<string>('proxy_url')).resolves.toBe('http://new-proxy:808')
      // 新库为空字符串 → 从旧库恢复（经 proxy_bypass 更名）
      await expect(db.getSetting<string>('proxy_no_proxy')).resolves.toBe('localhost,127.0.0.1')
      // 新库已有模型 → 不拷贝旧模型
      const modelConfigs = await db.listModelConfigs()
      expect(modelConfigs).toHaveLength(1)
      expect(modelConfigs[0].id).toBe('new-model-id')
      expect(modelConfigs[0].maxTokens).toBe(4096)
    } finally {
      await db.close()
    }
  })

  it('runs only once via the marker key and tolerates a missing legacy file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-legacy-migration-'))
    roots.push(root)
    await createLegacyDatabase(path.join(root, 'ohmyppt-prod.db'))

    const db = new PPTDatabase(path.join(root, 'ohmyppt.db'))
    await db.init()
    await db.close()

    // 第二次 init：标记存在，不重复导入（把 legacy 行删掉后重开也不会再导入）
    const legacy = createClient({ url: `file:${path.join(root, 'ohmyppt-prod.db')}` })
    await legacy.execute('DELETE FROM settings')
    await legacy.execute('DELETE FROM model_configs')
    await legacy.close()

    const reopened = new PPTDatabase(path.join(root, 'ohmyppt.db'))
    await reopened.init()
    try {
      await expect(reopened.getSetting<string>('timeout_ms_agent')).resolves.toBe(1200000)
      const modelConfigs = await reopened.listModelConfigs()
      expect(modelConfigs).toHaveLength(1)
    } finally {
      await reopened.close()
    }

    // 没有 legacy 文件时静默跳过
    const emptyRoot = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-legacy-migration-'))
    roots.push(emptyRoot)
    const noLegacy = new PPTDatabase(path.join(emptyRoot, 'ohmyppt.db'))
    await expect(noLegacy.init()).resolves.toBeUndefined()
    await noLegacy.close()
  })
})
