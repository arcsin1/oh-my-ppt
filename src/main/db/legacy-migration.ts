import fs from 'node:fs'
import path from 'node:path'
import log from 'electron-log/main.js'
import { createClient } from '@libsql/client'
import { MODEL_CONFIGS_TABLE_SQL, SETTINGS_TABLE_SQL } from './patch'

type LibSQLClient = ReturnType<typeof createClient>

// 上游 v2.8.0 把打包应用的数据库文件从 ohmyppt-prod.db 改名为 ohmyppt.db，
// 且没有携带任何迁移逻辑：从 v2.7.0 直接升级的用户设置/模型配置会被当成
// 全新安装（数据其实还留在旧文件里）。这里做一次性搬移：
// - settings：逐键拷贝；新库里已有非空值的键不覆盖（保留用户新输入），
//   空值/缺失的键才从旧库恢复；proxy_bypass 更名为 proxy_no_proxy
// - model_configs：仅当新库没有任何模型配置时整表拷贝（含加密 api_key，
//   safeStorage 密文与机器绑定，同机升级可直接解密）
// - sessions/projects 等业务数据不搬，避免与既有数据冲突
// 搬移完成后写入标记键，整个流程只跑一次。

const LEGACY_DB_FILENAME = 'ohmyppt-prod.db'
const MIGRATION_MARKER_KEY = 'legacy_prod_db_migrated_v1'
const SETTINGS_KEY_RENAMES: Record<string, string> = {
  proxy_bypass: 'proxy_no_proxy'
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

const isEmptyStoredValue = (raw: unknown): boolean => {
  if (raw === undefined || raw === null) return true
  const text = typeof raw === 'string' ? raw : String(raw)
  return text.length === 0 || text === '""' || text === 'null'
}

const upsertSetting = async (
  client: LibSQLClient,
  key: string,
  value: string,
  updatedAt: number
): Promise<void> => {
  await client.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, value, updatedAt]
  })
}

export const migrateLegacyProdDatabase = async (
  client: LibSQLClient,
  currentDbPath: string
): Promise<void> => {
  const legacyPath = path.join(path.dirname(currentDbPath), LEGACY_DB_FILENAME)
  if (path.resolve(legacyPath) === path.resolve(currentDbPath)) return
  if (!fs.existsSync(legacyPath)) return

  // 本迁移在 runDatabasePatches 之前执行，先确保两张目标表存在（DDL 与 patch 保持一致）
  await client.execute(SETTINGS_TABLE_SQL)
  await client.execute(MODEL_CONFIGS_TABLE_SQL)

  const marker = await client.execute({
    sql: 'SELECT key FROM settings WHERE key = ?',
    args: [MIGRATION_MARKER_KEY]
  })
  if (marker.rows.length > 0) return

  let legacy: LibSQLClient
  try {
    legacy = createClient({ url: `file:${legacyPath}` })
  } catch (error) {
    log.warn('[db] legacy prod database not readable', {
      legacyPath,
      message: error instanceof Error ? error.message : String(error)
    })
    return
  }

  let importedSettings = 0
  let importedModelConfigs = 0
  try {
    const legacySettings = await legacy.execute('SELECT key, value FROM settings')
    for (const row of legacySettings.rows) {
      const rawKey = typeof row.key === 'string' ? row.key : String(row.key ?? '')
      if (!rawKey || rawKey === MIGRATION_MARKER_KEY) continue
      const key = SETTINGS_KEY_RENAMES[rawKey] ?? rawKey
      const value = typeof row.value === 'string' ? row.value : String(row.value ?? '')
      const existing = await client.execute({
        sql: 'SELECT value FROM settings WHERE key = ?',
        args: [key]
      })
      const currentValue = existing.rows[0]?.value
      if (existing.rows.length > 0 && !isEmptyStoredValue(currentValue)) continue
      await upsertSetting(client, key, value, nowSeconds())
      importedSettings += 1
    }

    const currentModels = await client.execute('SELECT COUNT(*) AS count FROM model_configs')
    const currentCount = Number(
      (currentModels.rows[0] as { count?: unknown } | undefined)?.count ?? 0
    )
    if (currentCount === 0) {
      const legacyModels = await legacy.execute(
        `SELECT id, name, provider, model, api_key, base_url, max_tokens, active,
                created_at, updated_at
         FROM model_configs`
      )
      for (const row of legacyModels.rows) {
        await client.execute({
          sql: `INSERT INTO model_configs
                  (id, name, provider, model, api_key, base_url, max_tokens, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            String(row.id ?? ''),
            String(row.name ?? ''),
            String(row.provider ?? ''),
            String(row.model ?? ''),
            String(row.api_key ?? ''),
            String(row.base_url ?? ''),
            Number(row.max_tokens) || 4096,
            Number(row.active) || 0,
            Number(row.created_at) || nowSeconds(),
            Number(row.updated_at) || nowSeconds()
          ]
        })
        importedModelConfigs += 1
      }
    }

    await upsertSetting(client, MIGRATION_MARKER_KEY, 'true', nowSeconds())
    if (importedSettings > 0 || importedModelConfigs > 0) {
      log.info('[db] legacy prod database migrated', {
        legacyPath,
        importedSettings,
        importedModelConfigs
      })
    }
  } catch (error) {
    // 迁移失败不阻塞应用启动，旧文件保留，下次启动重试
    log.warn('[db] legacy prod database migration failed', {
      legacyPath,
      message: error instanceof Error ? error.message : String(error)
    })
  } finally {
    await Promise.resolve(legacy.close()).catch(() => undefined)
  }
}
