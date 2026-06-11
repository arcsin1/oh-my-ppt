const fs = require('fs/promises')
const path = require('path')
const { Arch } = require('builder-util')

const sourceFileNameFor = (platformName, archName) => {
  if (platformName === 'darwin' && archName === 'arm64') return 'ffmpeg-arm'
  if (platformName === 'darwin' && archName === 'x64') return 'ffmpeg-intel'
  if (platformName === 'win32' && archName === 'x64') return 'ffmpeg.exe'
  return null
}

const targetFileNameFor = (platformName) => (platformName === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')

exports.default = async function afterPack(context) {
  const platformName = context.electronPlatformName
  const archName = Arch[context.arch]
  const sourceFileName = sourceFileNameFor(platformName, archName)

  if (!sourceFileName) return

  const sourcePath = path.join(context.packager.projectDir, 'resources', 'ffmpeg', sourceFileName)
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir)
  const targetDir = path.join(resourcesDir, 'app.asar.unpacked', 'resources', 'ffmpeg')
  const targetPath = path.join(targetDir, targetFileNameFor(platformName))

  try {
    await fs.access(sourcePath)
  } catch {
    throw new Error(`Missing bundled ffmpeg for ${platformName}-${archName}: ${sourcePath}`)
  }

  await fs.rm(targetDir, { recursive: true, force: true })
  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(sourcePath, targetPath)

  if (platformName !== 'win32') {
    await fs.chmod(targetPath, 0o755)
  }

  console.log(`[afterPack] bundled ffmpeg ${sourceFileName} -> ${targetPath}`)
}
