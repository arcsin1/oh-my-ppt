import path from 'path'
import type { PPTDatabase, Session, SessionPageRecord, StyleRow } from '../db/database'
import type { ExternalAgentStyleSummary } from '@shared/external-agent'
import type { BrokerSessionLookupResult, ExternalAgentBrokerDataSource } from './broker'

function toStyleSummary(row: StyleRow): ExternalAgentStyleSummary {
  return {
    id: row.id,
    name: row.styleNameZh || row.styleName || row.style,
    description: row.description || '',
    category: row.category || 'default',
    version: row.version || '1.0.0'
  }
}

function toLookup(
  session: Session,
  pages: SessionPageRecord[],
  style?: StyleRow | null
): BrokerSessionLookupResult {
  return {
    session,
    pages: pages.map((page) => ({
      id: page.id,
      page_id: page.file_slug,
      pageNumber: page.page_number,
      title: page.title,
      status: page.status,
      contentOutline: null,
      layoutIntent: null
    })),
    styleSummary: style ? toStyleSummary(style) : null
  }
}

export function createDatabaseBrokerDataSource(db: PPTDatabase): ExternalAgentBrokerDataSource {
  const getSessionWithPages = async (
    sessionId: string
  ): Promise<BrokerSessionLookupResult | null> => {
    const session = await db.getSession(sessionId)
    if (!session) return null
    const pages = await db.listSessionPages(sessionId)
    const style = session.styleId ? await db.getStyleRow(session.styleId) : undefined
    return toLookup(session, pages, style)
  }
  return {
    async listAuthorizedSessions(sessionIds: string[]) {
      const results: BrokerSessionLookupResult[] = []
      for (const sessionId of sessionIds) {
        const lookup = await getSessionWithPages(sessionId)
        if (lookup) results.push(lookup)
      }
      return results
    },
    getSessionWithPages,
    async listAvailableStyles() {
      const rows = await db.listStyleRows()
      return rows.filter((row) => row.active).map(toStyleSummary)
    },
    async resolveSessionProjectDir(sessionId) {
      const project = await db.getProject(sessionId)
      const rootPath = typeof project?.root_path === 'string' ? project.root_path.trim() : ''
      return rootPath ? path.resolve(rootPath) : null
    }
  }
}
