#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'
import { listPackage, extractFile } from '@electron/asar'
import { parse } from 'acorn'
import { satisfies, validRange } from 'semver'

const BUILTIN_MODULES = new Set(
  builtinModules.flatMap((name) => {
    const normalized = name.replace(/^node:/, '')
    return [name, normalized, `node:${normalized}`]
  })
)

export const ALLOWED_EXTERNAL_PACKAGES = new Set([
  'electron',
  '@chenglou/pretext',
  '@libsql/client',
  '@napi-rs/canvas',
  '@node-rs/jieba',
  'node-readable-to-web-readable-stream',
  'pdfjs-dist'
])

export const ALLOWED_DYNAMIC_LOAD_EXPRESSIONS = new Set([
  // Bundled deepagents/LangChain contains a generic provider factory. Product
  // model creation uses the statically imported provider classes instead.
  'config2.package',
  // PDF.js fake-worker loading is bound to the packaged worker file by
  // src/main/utils/pdf-reference.ts.
  'this.workerSrc'
])

export const REQUIRED_ARCHIVE_PATHS = [
  '/out/main/index.js',
  '/out/preload/index.mjs',
  '/out/renderer/index.html',
  '/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node',
  '/node_modules/@napi-rs/canvas-win32-x64-msvc/icudtl.dat',
  '/node_modules/@node-rs/jieba-win32-x64-msvc/jieba.win32-x64-msvc.node',
  '/node_modules/@libsql/win32-x64-msvc/index.node',
  '/node_modules/@chenglou/pretext/dist/layout.js',
  '/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  '/node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf',
  '/resources/corporate-template/tpl_anjian_standard_v1/manifest.json',
  '/resources/styles/anjian-corporate/style.json'
]

export const normalizeArchivePath = (value) => {
  const normalized = value.replace(/\\/g, '/')
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

export const toNativeArchiveEntryPath = (archiveFilePath, separator = path.sep) =>
  archiveFilePath.replace(/^[/\\]+/, '').replaceAll('/', separator)

export const packageRootFromSpecifier = (specifier) => {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return ''
  if (specifier.startsWith('node:')) return ''
  if (/^(?:file|data|https?):/.test(specifier)) return ''
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

const isStringLiteral = (node) =>
  node?.type === 'Literal' && typeof node.value === 'string' && node.value.length > 0

const walkAst = (root, visit) => {
  const stack = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (typeof node.type === 'string') visit(node)
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent' || key === 'loc' || key === 'start' || key === 'end') continue
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) stack.push(value[index])
      } else if (value && typeof value === 'object') {
        stack.push(value)
      }
    }
  }
}

export const collectRuntimeSpecifiers = (source, sourceName = 'out/main/index.js') => {
  const ast = parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    allowHashBang: true
  })
  const requireAliases = new Set(['require'])
  const specifiers = []
  const dynamicLoads = []

  walkAst(ast, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.init?.type === 'CallExpression'
    ) {
      const callee = node.init.callee
      const isCreateRequire =
        (callee?.type === 'Identifier' && callee.name === 'createRequire') ||
        (callee?.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property?.type === 'Identifier' &&
          callee.property.name === 'createRequire')
      if (isCreateRequire) requireAliases.add(node.id.name)
    }
  })

  const addSpecifier = (node, kind) => {
    if (!isStringLiteral(node)) return false
    specifiers.push({
      specifier: node.value,
      kind,
      sourceName,
      line: node.loc?.start.line ?? 0
    })
    return true
  }

  walkAst(ast, (node) => {
    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
    ) {
      if (node.source) addSpecifier(node.source, 'esm')
      return
    }
    if (node.type === 'ImportExpression') {
      if (!addSpecifier(node.source, 'dynamic-import')) {
        dynamicLoads.push({
          kind: 'dynamic-import',
          sourceName,
          line: node.loc?.start.line ?? 0,
          expression: source.slice(node.source.start, node.source.end)
        })
      }
      return
    }
    if (node.type !== 'CallExpression') return

    if (node.callee?.type === 'Identifier' && requireAliases.has(node.callee.name)) {
      if (!addSpecifier(node.arguments[0], 'require')) {
        dynamicLoads.push({
          kind: 'dynamic-require',
          sourceName,
          line: node.loc?.start.line ?? 0,
          expression:
            node.arguments[0]?.start != null && node.arguments[0]?.end != null
              ? source.slice(node.arguments[0].start, node.arguments[0].end)
              : ''
        })
      }
      return
    }
    if (
      node.callee?.type === 'MemberExpression' &&
      !node.callee.computed &&
      node.callee.object?.type === 'Identifier' &&
      requireAliases.has(node.callee.object.name) &&
      node.callee.property?.type === 'Identifier' &&
      node.callee.property.name === 'resolve'
    ) {
      if (!addSpecifier(node.arguments[0], 'require-resolve')) {
        dynamicLoads.push({
          kind: 'dynamic-require-resolve',
          sourceName,
          line: node.loc?.start.line ?? 0,
          expression:
            node.arguments[0]?.start != null && node.arguments[0]?.end != null
              ? source.slice(node.arguments[0].start, node.arguments[0].end)
              : ''
        })
      }
    }
  })

  const unique = new Map()
  for (const item of specifiers) {
    unique.set(`${item.kind}:${item.specifier}:${item.sourceName}:${item.line}`, item)
  }
  return { specifiers: [...unique.values()], dynamicLoads }
}

export const validateDynamicLoads = (
  dynamicLoads,
  allowedExpressions = ALLOWED_DYNAMIC_LOAD_EXPRESSIONS
) => {
  const errors = []
  const warnings = []
  for (const item of dynamicLoads) {
    const message = `${item.sourceName}:${item.line} contains ${item.kind} with non-literal target "${item.expression}"`
    if (allowedExpressions.has(item.expression)) warnings.push(message)
    else errors.push(message)
  }
  return { errors, warnings }
}

export const validateRuntimeSpecifiers = (
  specifiers,
  allowedPackages = ALLOWED_EXTERNAL_PACKAGES
) => {
  const errors = []
  const externalPackageRoots = new Set()

  for (const item of specifiers) {
    const root = packageRootFromSpecifier(item.specifier)
    if (!root || BUILTIN_MODULES.has(root) || BUILTIN_MODULES.has(item.specifier)) continue
    externalPackageRoots.add(root)
    if (!allowedPackages.has(root)) {
      errors.push(
        `${item.sourceName}:${item.line} contains unexpected external runtime module "${item.specifier}"`
      )
    }
  }

  return { errors, externalPackageRoots }
}

const resolveArchiveDependencyManifest = (files, requesterManifest, dependencyName) => {
  let current = path.posix.dirname(requesterManifest)
  while (true) {
    const candidate = path.posix.join(
      current,
      'node_modules',
      dependencyName,
      'package.json'
    )
    if (files.has(candidate)) return candidate
    const parent = path.posix.dirname(current)
    if (parent === current) return ''
    current = parent
  }
}

export const validateDependencyClosure = ({
  files,
  rootPackageNames,
  readManifest
}) => {
  const errors = []
  const visited = new Set()
  const queue = []

  for (const packageName of rootPackageNames) {
    if (packageName === 'electron') continue
    const manifestPath = `/node_modules/${packageName}/package.json`
    if (!files.has(manifestPath)) {
      errors.push(`missing external package manifest ${manifestPath}`)
      continue
    }
    queue.push(manifestPath)
  }

  while (queue.length > 0) {
    const manifestPath = queue.shift()
    if (visited.has(manifestPath)) continue
    visited.add(manifestPath)

    let manifest
    try {
      manifest = readManifest(manifestPath)
    } catch (error) {
      errors.push(
        `cannot read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`
      )
      continue
    }

    const declaredDependencies = [
      ...Object.entries(manifest.dependencies ?? {}).map(([name, range]) => ({
        name,
        range,
        optional: false
      })),
      ...Object.entries(manifest.optionalDependencies ?? {}).map(([name, range]) => ({
        name,
        range,
        optional: true
      }))
    ]

    for (const {
      name: dependencyName,
      range: requestedVersion,
      optional
    } of declaredDependencies) {
      const dependencyManifestPath = resolveArchiveDependencyManifest(
        files,
        manifestPath,
        dependencyName
      )
      if (!dependencyManifestPath) {
        if (!optional) {
          errors.push(
            `${manifest.name ?? manifestPath}@${manifest.version ?? '?'} is missing dependency ${dependencyName}@${requestedVersion}`
          )
        }
        continue
      }

      let dependencyManifest
      try {
        dependencyManifest = readManifest(dependencyManifestPath)
      } catch (error) {
        errors.push(
          `cannot read ${dependencyManifestPath}: ${error instanceof Error ? error.message : String(error)}`
        )
        continue
      }

      const range = validRange(requestedVersion)
      if (
        range &&
        dependencyManifest.version &&
        !satisfies(dependencyManifest.version, range, { includePrerelease: true })
      ) {
        errors.push(
          `${manifest.name ?? manifestPath}@${manifest.version ?? '?'} resolves ${dependencyName}@${dependencyManifest.version}, expected ${requestedVersion}`
        )
      }
      queue.push(dependencyManifestPath)
    }
  }

  return { errors, visited }
}

export const validateRequiredArchivePaths = (
  files,
  requiredPaths = REQUIRED_ARCHIVE_PATHS
) =>
  requiredPaths
    .filter((requiredPath) => !files.has(requiredPath))
    .map((requiredPath) => `missing required packaged runtime file ${requiredPath}`)

const readArchiveText = (archivePath, archiveFilePath) =>
  extractFile(archivePath, toNativeArchiveEntryPath(archiveFilePath)).toString('utf8')

export const verifyPackagedRuntime = ({
  archivePath,
  expectedVersion,
  allowedPackages = ALLOWED_EXTERNAL_PACKAGES,
  requiredPaths = REQUIRED_ARCHIVE_PATHS
}) => {
  const files = new Set(listPackage(archivePath).map(normalizeArchivePath))
  const errors = validateRequiredArchivePaths(files, requiredPaths)
  const allSpecifiers = []
  const dynamicLoads = []
  const mainBundlePaths = [...files]
    .filter((filePath) => /^\/out\/main\/.*\.(?:js|mjs|cjs)$/.test(filePath))
    .sort()

  if (mainBundlePaths.length === 0) {
    errors.push('no JavaScript files found under /out/main')
  }

  for (const mainBundlePath of mainBundlePaths) {
    try {
      const result = collectRuntimeSpecifiers(
        readArchiveText(archivePath, mainBundlePath),
        mainBundlePath
      )
      allSpecifiers.push(...result.specifiers)
      dynamicLoads.push(...result.dynamicLoads)
    } catch (error) {
      errors.push(
        `cannot parse ${mainBundlePath}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const runtimeValidation = validateRuntimeSpecifiers(allSpecifiers, allowedPackages)
  errors.push(...runtimeValidation.errors)
  const dynamicValidation = validateDynamicLoads(dynamicLoads)
  errors.push(...dynamicValidation.errors)

  const manifestCache = new Map()
  const readManifest = (manifestPath) => {
    if (!manifestCache.has(manifestPath)) {
      manifestCache.set(
        manifestPath,
        JSON.parse(readArchiveText(archivePath, manifestPath))
      )
    }
    return manifestCache.get(manifestPath)
  }

  const archiveManifest = files.has('/package.json') ? readManifest('/package.json') : null
  if (!archiveManifest) {
    errors.push('missing packaged application /package.json')
  } else if (expectedVersion && archiveManifest.version !== expectedVersion) {
    errors.push(
      `packaged application version ${archiveManifest.version ?? '?'} does not match expected ${expectedVersion}`
    )
  }

  const closure = validateDependencyClosure({
    files,
    rootPackageNames: runtimeValidation.externalPackageRoots,
    readManifest
  })
  errors.push(...closure.errors)

  return {
    errors,
    warnings: dynamicValidation.warnings,
    externalPackageRoots: [...runtimeValidation.externalPackageRoots].sort(),
    checkedPackageManifests: closure.visited.size,
    mainBundlePaths,
    packagedVersion: archiveManifest?.version ?? ''
  }
}

const parseCliArgs = (argv) => {
  const result = {
    archivePath: 'dist/win-unpacked/resources/app.asar',
    expectedVersion: ''
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--asar') result.archivePath = argv[index + 1] ?? ''
    if (argv[index] === '--expected-version') result.expectedVersion = argv[index + 1] ?? ''
  }
  return result
}

const runCli = () => {
  const args = parseCliArgs(process.argv.slice(2))
  const archivePath = path.resolve(args.archivePath)
  if (!fs.existsSync(archivePath)) {
    console.error(`[packaged-runtime] archive not found: ${archivePath}`)
    process.exitCode = 1
    return
  }

  const result = verifyPackagedRuntime({
    archivePath,
    expectedVersion: args.expectedVersion
  })
  for (const warning of result.warnings) console.warn(`[packaged-runtime] warning: ${warning}`)
  if (result.errors.length > 0) {
    console.error(`[packaged-runtime] FAILED with ${result.errors.length} error(s)`)
    for (const error of result.errors) console.error(`- ${error}`)
    process.exitCode = 1
    return
  }

  console.log(
    `[packaged-runtime] OK version=${result.packagedVersion} bundles=${result.mainBundlePaths.length} externalRoots=${result.externalPackageRoots.length} manifests=${result.checkedPackageManifests}`
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli()
}
