import type { createClient } from '@libsql/client'

type LibSqlClient = ReturnType<typeof createClient>

/**
 * Patch: add version and style_case columns to styles table.
 */
export const patchStylesColumns = async (client: LibSqlClient): Promise<void> => {
  const cols = await client.execute("PRAGMA table_info('styles')")
  const columnNames = new Set(cols.rows.map((r) => r.name as string))

  if (!columnNames.has('version')) {
    await client.execute("ALTER TABLE styles ADD COLUMN version TEXT NOT NULL DEFAULT '1.0.0'")
  } else {
    await migrateStyleVersionToText(client, cols.rows as Array<Record<string, unknown>>)
  }
  const nextColumnNames = await getTableColumnNames(client, 'styles')
  if (!nextColumnNames.has('style_case')) {
    await client.execute("ALTER TABLE styles ADD COLUMN style_case TEXT NOT NULL DEFAULT ''")
  }
  if (!nextColumnNames.has('image_generation_prompt')) {
    await client.execute("ALTER TABLE styles ADD COLUMN image_generation_prompt TEXT NOT NULL DEFAULT ''")
  }
  if (!nextColumnNames.has('style_name_zh')) {
    await client.execute("ALTER TABLE styles ADD COLUMN style_name_zh TEXT NOT NULL DEFAULT ''")
    await client.execute("UPDATE styles SET style_name_zh = style_name WHERE style_name_zh = ''")
  }
  if (!nextColumnNames.has('style_name_en')) {
    await client.execute("ALTER TABLE styles ADD COLUMN style_name_en TEXT NOT NULL DEFAULT ''")
  }
  if (!nextColumnNames.has('package_dir')) {
    await client.execute("ALTER TABLE styles ADD COLUMN package_dir TEXT NOT NULL DEFAULT ''")
  }
  if (!nextColumnNames.has('active')) {
    await client.execute('ALTER TABLE styles ADD COLUMN active INTEGER NOT NULL DEFAULT 1')
  }
  if (!nextColumnNames.has('favorite_at')) {
    await client.execute('ALTER TABLE styles ADD COLUMN favorite_at INTEGER')
  }
  await client.execute(`
    CREATE TABLE IF NOT EXISTS session_style_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      style_id TEXT NOT NULL,
      style_key TEXT NOT NULL,
      style_name TEXT NOT NULL,
      style_name_zh TEXT NOT NULL DEFAULT '',
      style_name_en TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      aliases TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0.0',
      style_case TEXT NOT NULL DEFAULT '',
      image_generation_prompt TEXT NOT NULL DEFAULT '',
      package_dir TEXT NOT NULL DEFAULT '',
      style_skill TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )
  `)
  await ensureSessionSnapshotColumn(client, 'style_name_zh', "TEXT NOT NULL DEFAULT ''")
  await ensureSessionSnapshotColumn(client, 'style_name_en', "TEXT NOT NULL DEFAULT ''")
  await ensureSessionSnapshotColumn(client, 'image_generation_prompt', "TEXT NOT NULL DEFAULT ''")
  await ensureSessionSnapshotColumn(client, 'package_dir', "TEXT NOT NULL DEFAULT ''")
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS session_style_snapshots_session_id_unique ON session_style_snapshots(session_id)'
  )
  await backfillSessionStyleSnapshots(client)
}

const getTableColumnNames = async (client: LibSqlClient, tableName: string): Promise<Set<string>> => {
  const cols = await client.execute(`PRAGMA table_info('${tableName}')`)
  return new Set(cols.rows.map((row) => row.name as string))
}

const normalizeVersion = (value: unknown): string => {
  const raw = String(value ?? '').trim().replace(/^v/i, '')
  if (!raw) return '1.0.0'
  const parts = raw
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => {
      const parsed = Number.parseInt(part, 10)
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
    })
  while (parts.length < 3) parts.push(0)
  if (parts.every((part) => part === 0) && !/^0+(?:[.-]0+){0,2}$/.test(raw)) return '1.0.0'
  return parts.join('.')
}

const migrateStyleVersionToText = async (
  client: LibSqlClient,
  rows: Array<Record<string, unknown>>
): Promise<void> => {
  const versionColumn = rows.find((row) => row.name === 'version')
  const type = String(versionColumn?.type || '').toUpperCase()
  if (type.includes('TEXT')) {
    const existing = await client.execute('SELECT id, version FROM styles')
    for (const row of existing.rows) {
      const record = row as Record<string, unknown>
      const id = String(record.id || '')
      if (!id) continue
      const normalized = normalizeVersion(record.version)
      if (normalized !== String(record.version || '')) {
        await client.execute({
          sql: 'UPDATE styles SET version = ? WHERE id = ?',
          args: [normalized, id]
        })
      }
    }
    return
  }

  const legacyColumnNames = new Set(rows.map((row) => row.name as string))
  const legacyColumn = (name: string, fallback: string): string =>
    legacyColumnNames.has(name) ? `COALESCE(${name}, ${fallback})` : fallback
  await client.execute('DROP INDEX IF EXISTS idx_styles_style')
  await client.execute('ALTER TABLE styles RENAME TO styles_legacy_version')
  await client.execute(`
    CREATE TABLE styles (
      id TEXT PRIMARY KEY,
      style TEXT UNIQUE NOT NULL,
      style_name TEXT NOT NULL,
      style_name_zh TEXT NOT NULL DEFAULT '',
      style_name_en TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      aliases TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'custom',
      style_skill TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '1.0.0',
      style_case TEXT NOT NULL DEFAULT '',
      image_generation_prompt TEXT NOT NULL DEFAULT '',
      package_dir TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      favorite_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  await client.execute(`
    INSERT INTO styles (
      id, style, style_name, description, category, aliases, source, style_skill,
      version, style_case, image_generation_prompt, style_name_zh, style_name_en, package_dir, active, favorite_at, created_at, updated_at
    )
    SELECT
      id, style, style_name,
      COALESCE(description, ''),
      COALESCE(category, ''),
      COALESCE(aliases, '[]'),
      COALESCE(source, 'custom'),
      COALESCE(style_skill, ''),
      '1.0.0',
      ${legacyColumn('style_case', "''")},
      ${legacyColumn('image_generation_prompt', "''")},
      style_name,
      '',
      '',
      ${legacyColumn('active', '1')},
      ${legacyColumn('favorite_at', 'NULL')},
      created_at,
      updated_at
    FROM styles_legacy_version
  `)
  const existing = await client.execute('SELECT id, version FROM styles_legacy_version')
  for (const row of existing.rows) {
    const record = row as Record<string, unknown>
    const id = String(record.id || '')
    if (!id) continue
    await client.execute({
      sql: 'UPDATE styles SET version = ? WHERE id = ?',
      args: [normalizeVersion(record.version), id]
    })
  }
  await client.execute('DROP TABLE styles_legacy_version')
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_styles_style ON styles(style)')
}

const backfillSessionStyleSnapshots = async (client: LibSqlClient): Promise<void> => {
  await client.execute(`
    INSERT OR IGNORE INTO session_style_snapshots (
      id,
      session_id,
      style_id,
      style_key,
      style_name,
      style_name_zh,
      style_name_en,
      description,
      category,
      aliases,
      source,
      version,
      style_case,
      image_generation_prompt,
      package_dir,
      style_skill,
      created_at
    )
    SELECT
      lower(hex(randomblob(16))),
      sessions.id,
      chosen.id,
      chosen.style,
      chosen.style_name,
      COALESCE(chosen.style_name_zh, chosen.style_name),
      COALESCE(chosen.style_name_en, ''),
      COALESCE(chosen.description, ''),
      COALESCE(chosen.category, ''),
      COALESCE(chosen.aliases, '[]'),
      COALESCE(chosen.source, 'custom'),
      COALESCE(chosen.version, '1.0.0'),
      COALESCE(chosen.style_case, ''),
      COALESCE(chosen.image_generation_prompt, ''),
      COALESCE(chosen.package_dir, ''),
      COALESCE(chosen.style_skill, ''),
      strftime('%s', 'now')
    FROM sessions
    LEFT JOIN styles AS by_id ON by_id.id = sessions.style_id
    LEFT JOIN styles AS by_style ON by_style.style = sessions.style_id
    LEFT JOIN styles AS minimal ON minimal.style = 'minimal-white'
    JOIN styles AS chosen ON chosen.id = COALESCE(by_id.id, by_style.id, minimal.id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM session_style_snapshots
      WHERE session_style_snapshots.session_id = sessions.id
    )
  `)
  await client.execute(`
    UPDATE session_style_snapshots
    SET image_generation_prompt = COALESCE((
      SELECT styles.image_generation_prompt
      FROM styles
      WHERE styles.id = session_style_snapshots.style_id
    ), '')
    WHERE COALESCE(image_generation_prompt, '') = ''
  `)
  await client.execute(`
    UPDATE sessions
    SET style_id = (
      SELECT session_style_snapshots.style_id
      FROM session_style_snapshots
      WHERE session_style_snapshots.session_id = sessions.id
    )
    WHERE EXISTS (
      SELECT 1
      FROM session_style_snapshots
      WHERE session_style_snapshots.session_id = sessions.id
    )
    AND COALESCE(sessions.style_id, '') != (
      SELECT session_style_snapshots.style_id
      FROM session_style_snapshots
      WHERE session_style_snapshots.session_id = sessions.id
    )
  `)
}

const ensureSessionSnapshotColumn = async (
  client: LibSqlClient,
  columnName: string,
  definition: string
): Promise<void> => {
  const cols = await client.execute("PRAGMA table_info('session_style_snapshots')")
  const columnNames = new Set(cols.rows.map((row) => row.name as string))
  if (!columnNames.has(columnName)) {
    await client.execute(`ALTER TABLE session_style_snapshots ADD COLUMN ${columnName} ${definition}`)
  }
}
