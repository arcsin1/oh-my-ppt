import type { createClient } from '@libsql/client'

type LibSqlClient = ReturnType<typeof createClient>

export const patchExternalAgentTables = async (client: LibSqlClient): Promise<void> => {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS external_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      executable_path TEXT,
      credential_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked_at INTEGER
    )
  `)

  await client.execute(`
    CREATE TABLE IF NOT EXISTS external_agent_grants (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES external_agents(id) ON DELETE CASCADE,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      session_ids_json TEXT NOT NULL DEFAULT '[]',
      workspace_roots_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked_at INTEGER
    )
  `)
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS external_agent_grants_agent_id_unique ON external_agent_grants(agent_id)'
  )

  await client.execute(`
    CREATE TABLE IF NOT EXISTS external_agent_operations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES external_agents(id) ON DELETE CASCADE,
      session_id TEXT,
      tool_name TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      request_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      checkpoint TEXT,
      result_ref TEXT,
      error_code TEXT,
      resumable INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS external_agent_operations_idempotency_unique ON external_agent_operations(agent_id, idempotency_key)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_external_agent_operations_session_status ON external_agent_operations(session_id, status, created_at)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_external_agent_operations_agent_status ON external_agent_operations(agent_id, status, updated_at)'
  )

  await client.execute(`
    CREATE TABLE IF NOT EXISTS external_agent_events (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL REFERENCES external_agent_operations(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      occurred_at INTEGER NOT NULL
    )
  `)
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS external_agent_events_seq_unique ON external_agent_events(operation_id, sequence)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_external_agent_events_operation_seq ON external_agent_events(operation_id, sequence)'
  )

  const operationColumns = await client.execute("PRAGMA table_info('external_agent_operations')")
  const hasRequestJson = operationColumns.rows.some((row) => row.name === 'request_json')
  if (!hasRequestJson) {
    await client.execute(
      "ALTER TABLE external_agent_operations ADD COLUMN request_json TEXT NOT NULL DEFAULT '{}'"
    )
  }
}
