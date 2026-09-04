import type { createClient } from '@libsql/client'

type LibSqlClient = ReturnType<typeof createClient>

/** Persist structured section-agenda topics independently from the mutable reason text. */
export const patchSourcePageSkeletonAgendaItems = async (client: LibSqlClient): Promise<void> => {
  const columns = await client.execute("PRAGMA table_info('source_page_skeletons')")
  if (columns.rows.some((row) => row.name === 'agenda_items_json')) return

  await client.execute('ALTER TABLE source_page_skeletons ADD COLUMN agenda_items_json TEXT')
}
