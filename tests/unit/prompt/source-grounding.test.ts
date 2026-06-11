import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8')

describe('source-grounded prompt rules', () => {
  it('parse plan uses single-shot model and outline scan', () => {
    const source = readSource('src/main/ipc/io/document-parse-handlers.ts')
    const outlineScan = readSource('src/main/ipc/io/document-outline-scan.ts')

    expect(source).toContain('single-shot document parsing task')
    expect(source).toContain('You have no filesystem tools in this call')
    expect(source).toContain('bounded source preview')
    expect(source).toContain('MAX_PARSE_SOURCE_PREVIEW_CHARS')
    expect(source).not.toContain('attachProductSkillsBackend')
    expect(source).not.toContain('createDeepAgent')
    expect(source).not.toContain('product_skill_read_file')
    expect(source).toContain('Do not ask to read the file')
    expect(source).toContain('Do not write detailed facts')
    expect(source).toContain('hasOutlinePageCandidateSkeleton')
    expect(source).not.toContain('rawPageCountInput')
    expect(source).not.toContain('requestedPageCount')
    expect(source).not.toContain('userPageCount')
    expect(source).not.toContain('User-provided page count')
    expect(source).toContain('runSingleShotDocumentPlanModel')
    expect(source).toContain('single-shot model invoke')
    expect(source).toContain('sourcePreviewLength')
    expect(source).toContain('[documents:parsePlan] end')
    expect(source).toContain('durationMs')
    expect(source).toContain('csv converted for reading')
    expect(source).toContain('normalized candidate plan')
    expect(source).toContain('document outline page-count estimate')
    expect(source).toContain('deterministic source-structure page-count estimate')
    expect(source).toContain('outline quality check failed after retry, rejecting plan')
    expect(source).toContain('isDocumentOutlineQualityError')
    expect(source).toContain('Source document path for later generation only')
    expect(outlineScan).toContain('Document structure scan')
    expect(outlineScan).toContain('Heading map truncated')
    expect(outlineScan).toContain('Deterministic slide-count estimate')
    expect(outlineScan).toContain('deriveOutlinePageCandidates')
    expect(outlineScan).toContain('Page candidate skeleton')
    expect(source).toContain('page candidate skeleton')
    expect(source).toContain('skeleton count')
    expect(source).toContain('compact page skeleton')
    expect(source).toContain('source line range')
    expect(source).toContain('chapter divider slides')
    expect(source).toContain('页面角色：章节页')
    expect(source).toContain('assertPlanMatchesDocumentOutline')
  })

  it('frontend lets document parse infer pageCount from source structure', () => {
    const sessionCreate = readSource('src/renderer/src/pages/session-create.tsx')
    const templateUseDialog = readSource(
      'src/renderer/src/components/templates/TemplateUseDialog.tsx'
    )
    const sessionParseCall = sessionCreate.slice(
      sessionCreate.indexOf('const result = await ipc.parseDocumentPlan({'),
      sessionCreate.indexOf('const nextSuggestion = {')
    )
    const templateParseCall = templateUseDialog.slice(
      templateUseDialog.indexOf('const result = await ipc.parseDocumentPlan({'),
      templateUseDialog.indexOf('const referenceFile = result.files[0] || attachedReferenceFile')
    )

    expect(sessionParseCall).toContain('ipc.parseDocumentPlan')
    expect(templateParseCall).toContain('ipc.parseDocumentPlan')
    expect(sessionParseCall).not.toContain('pageCount:')
    expect(sessionParseCall).not.toContain('resolvePageCount')
    expect(templateParseCall).not.toContain('pageCount:')
    expect(templateParseCall).not.toContain('resolvePageCount')
  })

  it('template document analysis reuses the shared suggestion dialog', () => {
    const templateUseDialog = readSource(
      'src/renderer/src/components/templates/TemplateUseDialog.tsx'
    )

    expect(templateUseDialog).toContain('SessionCreateSuggestionDialog')
    expect(templateUseDialog).not.toContain('updateDraftSourcePlanItems')
    expect(templateUseDialog).not.toContain('editingOutlineIndex')
    expect(templateUseDialog).not.toContain('suggestionCardClass')
  })

  it('edit, add-page, and retry-single-page flows resolve source documents', () => {
    const generationContext = readSource('src/main/ipc/generation/context.ts')
    const sourceDocuments = readSource('src/main/ipc/generation/source-documents.ts')
    const editFlow = readSource('src/main/ipc/generation/edit-flow.ts')
    const deckAllPageEditFlow = readSource('src/main/ipc/generation/edit-deck-allpage-flow.ts')
    const addPageFlow = readSource('src/main/ipc/generation/add-page-flow.ts')
    const retrySinglePageFlow = readSource('src/main/ipc/generation/retry-single-page-flow.ts')

    expect(generationContext).toContain(
      "export { resolveSourceDocuments } from './source-documents'"
    )
    expect(sourceDocuments).toContain('appendSourceDocumentPath(resolveExistingSessionDoc')
    expect(sourceDocuments).toContain('appendSourceDocumentPath(`/docs/${safeName}`)')
    expect(generationContext).not.toContain("mode === 'edit') return []")
    expect(generationContext).not.toContain('isFirstDeckGeneration')
    expect(editFlow).toContain('resolveSourceDocuments')
    expect(editFlow).toContain('sourceDocumentPaths: context.sourceDocumentPaths')
    expect(deckAllPageEditFlow).toContain('sourceDocumentPaths: context.sourceDocumentPaths')
    expect(addPageFlow).toContain('resolveSourceDocuments')
    expect(addPageFlow).toContain('sourceDocumentPaths: context.sourceDocumentPaths')
    expect(addPageFlow).not.toContain('sourceDocumentPaths: []')
    expect(retrySinglePageFlow).toContain('resolveSourceDocuments')
    expect(retrySinglePageFlow).toContain('sourceDocumentPaths: context.sourceDocumentPaths')
    expect(retrySinglePageFlow).not.toContain('sourceDocumentPaths: []')
  })

  it('edit prompt injects source document rules', () => {
    const editSystem = readSource('src/main/prompt/edit-system.ts')

    expect(editSystem).toContain('Source documents (content evidence)')
    expect(editSystem).toContain('SOURCE_DOCUMENT_READ_STRATEGY')
    expect(editSystem).toContain('sourceDocumentPaths:')
    expect(editSystem).toContain('For pure visual/style-only edits')
  })

  it('planNewPage includes source document context', () => {
    const engineGenerate = readSource('src/main/ipc/engine/generate.ts')

    expect(engineGenerate).toContain('sourceDocumentPaths?: string[]')
    expect(engineGenerate).toContain('Source document context:')
  })

  it('single-slide planning can preserve explicit topic lists', () => {
    const engineGenerate = readSource('src/main/ipc/engine/generate.ts')
    const generationUser = readSource('src/main/prompt/generation-user.ts')
    const planningSource = readSource('src/main/prompt/planning.ts')
    const runtimeUserSource = readSource('src/main/prompt/runtime-user.ts')

    expect(engineGenerate).toContain('keyPoints must contain 1-10 short phrases')
    expect(engineGenerate).toContain('preserve each listed topic as a separate key point')
    expect(generationUser).toContain('If there are 2-10 points')
    expect(generationUser).toContain('keep them as distinct visible topics')
    expect(planningSource).toContain('Provide 1-10 key points per slide')
    expect(runtimeUserSource).toContain('keyPoints must contain 1-10 strings')
  })

  it('blocks generic filler slides during planning', () => {
    const sharedSource = readSource('src/main/prompt/shared.ts')
    const planningSource = readSource('src/main/prompt/planning.ts')
    const runtimeUserSource = readSource('src/main/prompt/runtime-user.ts')

    expect(planningSource).toContain('SOURCE_MATERIAL_PLANNING_RULES')
    expect(sharedSource).toContain('Apply these rules only when source documents')
    expect(sharedSource).toContain('Stay source-grounded and avoid creative drift')
    expect(sharedSource).toContain('split source-backed sections')
    expect(sharedSource).toContain('Do not add generic agenda')
    expect(planningSource).toContain('For open-ended topics without source materials')
    expect(planningSource).not.toContain('split or merge')
    expect(runtimeUserSource).toContain('hasSourceMaterialCue')
    expect(runtimeUserSource).toContain('hasSourceMaterials?: boolean')
    expect(runtimeUserSource).toContain('args.hasSourceMaterials || hasSourceMaterialCue')
    expect(runtimeUserSource).toContain('SOURCE_MATERIAL_PLANNING_RULES')
    expect(runtimeUserSource).not.toContain(
      'Do not reinterpret the reference document into a new creative storyline'
    )
  })

  it('requires source inspection before source-backed slide generation', () => {
    const sharedSource = readSource('src/main/prompt/shared.ts')
    const source = readSource('src/main/prompt/generation-user.ts')
    const sourceReadingSkill = readSource('resources/skills/oh-my-ppt-source-reading/SKILL.md')

    expect(sharedSource).toContain('SOURCE_READING_SKILL_NAME')
    expect(sharedSource).toContain('Before using source documents')
    expect(sharedSource).toContain('not as final evidence or permission to freestyle')
    expect(sharedSource).not.toContain('Before writing source-backed content')
    expect(sharedSource).not.toContain('Do not read entire long documents into context at once')
    expect(sourceReadingSkill).toContain(
      'Use the DeepAgents filesystem tool `grep(pattern, path, glob)`'
    )
    expect(sourceReadingSkill).toContain('Use the DeepAgents filesystem tool `glob(pattern, path)`')
    expect(sourceReadingSkill).toContain('`pattern` is a literal string')
    expect(sourceReadingSkill).toContain('Use `read_file` only on targeted sections')
    expect(sourceReadingSkill).toContain('repeat grep -> targeted read')
    expect(sourceReadingSkill).toContain('retrieved snippet conflicts with the source passage')
    expect(sourceReadingSkill).toContain('Slide title: "Q3 Revenue Highlights"')
    expect(sourceReadingSkill).toContain('Prefer 50-80 lines around grep matches')
    expect(source).toContain('expansion must be source-grounded')
    expect(source).toContain('SOURCE_DOCUMENT_FACT_RULE')
    expect(sharedSource).toContain('examples, risks, decisions, or conclusions')
    expect(source).not.toContain('first use grep or glob')
    expect(source).not.toContain('you do not need to reread')
  })
})
