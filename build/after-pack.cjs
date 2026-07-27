const fs = require('fs/promises')
const path = require('path')

const CORPORATE_STYLE_ENTRIES = new Set(['anjian-corporate', 'manifest.json'])

const pruneDirectoryExcept = async (directory, allowedEntries) => {
  let entries = []
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return 0
    throw error
  }

  let removed = 0
  for (const entry of entries) {
    if (allowedEntries.has(entry.name)) continue
    await fs.rm(path.join(directory, entry.name), { recursive: true, force: true })
    removed += 1
  }
  return removed
}

exports.default = async function afterPack(context) {
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir)
  const unpackedResources = path.join(resourcesDir, 'app.asar.unpacked', 'resources')

  // MP4 export is intentionally outside the internal product scope.
  await fs.rm(path.join(unpackedResources, 'ffmpeg'), { recursive: true, force: true })

  // Runtime generation still needs one installed style package, but the public
  // style catalogue and user style-management UI are removed.
  const removedStyleCount = await pruneDirectoryExcept(
    path.join(unpackedResources, 'styles'),
    CORPORATE_STYLE_ENTRIES
  )

  console.log(
    `[afterPack] internal package scope applied: removed ${removedStyleCount} generic styles; ffmpeg omitted`
  )
}
