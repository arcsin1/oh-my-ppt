param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [string]$ExpectedVersion = '1.0.3'
)

$ErrorActionPreference = 'Stop'

$installer = (Resolve-Path $InstallerPath).Path
$installDir = Join-Path $env:RUNNER_TEMP '安居建业\PPT助手'
$userDataDir = Join-Path $env:RUNNER_TEMP 'ajjy-ppt-smoke-user-data'
$stdoutPath = Join-Path $env:RUNNER_TEMP 'ajjy-ppt-smoke.stdout.log'
$stderrPath = Join-Path $env:RUNNER_TEMP 'ajjy-ppt-smoke.stderr.log'
$readyMarker = '[app] main window ready-to-show'

function Get-ReadyMarkerCount {
  if (-not (Test-Path $userDataDir)) {
    return 0
  }

  $count = 0
  Get-ChildItem -Path $userDataDir -Recurse -File -Filter "*-v$ExpectedVersion.log" `
    -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $content = Get-Content -Path $_.FullName -Raw -ErrorAction Stop
        $count += ([regex]::Matches($content, [regex]::Escape($readyMarker))).Count
      } catch {
        # The application may still be flushing the log; retry on the next poll.
      }
    }
  return $count
}

function Start-And-AssertReady {
  param([int]$Attempt)

  $beforeCount = Get-ReadyMarkerCount
  $process = Start-Process `
    -FilePath (Join-Path $installDir 'AnjuJianyePPT.exe') `
    -ArgumentList "--user-data-dir=$userDataDir" `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

  $deadline = (Get-Date).AddSeconds(30)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    $process.Refresh()
    if ($process.HasExited) {
      $stderr = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { '' }
      throw "Application exited before ready-to-show on attempt $Attempt. ExitCode=$($process.ExitCode)`n$stderr"
    }
    if ((Get-ReadyMarkerCount) -gt $beforeCount) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $stderr = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { '' }
    throw "Application did not emit ready-to-show within 30 seconds on attempt $Attempt.`n$stderr"
  }

  Stop-Process -Id $process.Id -Force
  Wait-Process -Id $process.Id -ErrorAction SilentlyContinue
  Write-Host "[windows-smoke] launch attempt $Attempt reached ready-to-show"
}

Write-Host "[windows-smoke] installing $installer to $installDir"
$installProcess = Start-Process `
  -FilePath $installer `
  -ArgumentList @('/S', "/D=$installDir") `
  -PassThru `
  -Wait
if ($installProcess.ExitCode -ne 0) {
  throw "Installer failed with exit code $($installProcess.ExitCode)"
}

$applicationExe = Join-Path $installDir 'AnjuJianyePPT.exe'
if (-not (Test-Path $applicationExe)) {
  throw "Installed executable not found: $applicationExe"
}

Start-And-AssertReady -Attempt 1
Start-And-AssertReady -Attempt 2

$uninstaller = Get-ChildItem -Path $installDir -File -Filter 'Uninstall*.exe' |
  Select-Object -First 1
if (-not $uninstaller) {
  throw "Uninstaller not found under $installDir"
}

Write-Host "[windows-smoke] uninstalling with $($uninstaller.FullName)"
$uninstallProcess = Start-Process `
  -FilePath $uninstaller.FullName `
  -ArgumentList '/S' `
  -PassThru `
  -Wait
if ($uninstallProcess.ExitCode -ne 0) {
  throw "Uninstaller failed with exit code $($uninstallProcess.ExitCode)"
}

$uninstallDeadline = (Get-Date).AddSeconds(30)
while ((Test-Path $applicationExe) -and (Get-Date) -lt $uninstallDeadline) {
  Start-Sleep -Seconds 1
}
if (Test-Path $applicationExe) {
  throw "Installed executable still exists after uninstall: $applicationExe"
}

Write-Host '[windows-smoke] install, two launches, and uninstall passed'
