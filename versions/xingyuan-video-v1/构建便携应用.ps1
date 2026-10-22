$ErrorActionPreference = 'Stop'

$versionRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $versionRoot '..\..'))
$electronDist = Join-Path $projectRoot 'node_modules\electron\dist'
$allowedDistRoot = [System.IO.Path]::GetFullPath((Join-Path $versionRoot 'dist'))
$portableRoot = [System.IO.Path]::GetFullPath((Join-Path $allowedDistRoot '星渊桌宠-portable'))
$buildStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$buildRoot = [System.IO.Path]::GetFullPath((Join-Path $allowedDistRoot "星渊桌宠-build-$buildStamp"))
$backupRoot = [System.IO.Path]::GetFullPath((Join-Path $allowedDistRoot "星渊桌宠-previous-$buildStamp"))

$allowedPrefix = $allowedDistRoot.TrimEnd('\') + '\'
foreach ($target in @($portableRoot, $buildRoot, $backupRoot)) {
    if (-not $target.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to move output outside the version dist directory: $target"
    }
}

$requiredSources = @(
    (Join-Path $electronDist 'electron.exe'),
    (Join-Path $versionRoot 'app-package.json'),
    (Join-Path $versionRoot 'NOTICE.md'),
    (Join-Path $versionRoot 'preview\pet.cjs'),
    (Join-Path $versionRoot 'preview\geometry.cjs'),
    (Join-Path $versionRoot 'preview\pet-preload.cjs'),
    (Join-Path $versionRoot 'preview\index.html'),
    (Join-Path $versionRoot 'preview\pet.css'),
    (Join-Path $versionRoot 'preview\pet.js'),
    (Join-Path $versionRoot 'preview\hit-test.js'),
    (Join-Path $versionRoot 'preview\settings.html'),
    (Join-Path $versionRoot 'preview\settings.css'),
    (Join-Path $versionRoot 'preview\settings.js'),
    (Join-Path $versionRoot 'preview\size.html'),
    (Join-Path $versionRoot 'preview\size.css'),
    (Join-Path $versionRoot 'preview\size.js'),
    (Join-Path $versionRoot 'preview\quota.cjs'),
    (Join-Path $versionRoot 'preview\quota.html'),
    (Join-Path $versionRoot 'preview\quota.css'),
    (Join-Path $versionRoot 'preview\quota.js'),
    (Join-Path $versionRoot 'reference\xingyuan-animation-master-v1.png'),
    (Join-Path $versionRoot 'edit\animations\generated-idle-v1\xingyuan-idle-alpha-v1.webm'),
    (Join-Path $versionRoot 'edit\animations\generated-active-v1\xingyuan-active-alpha-v1.webm'),
    (Join-Path $versionRoot 'edit\animations\generated-sleep-v1\xingyuan-sleep-alpha-v1.webm')
    (Join-Path $versionRoot 'edit\animations\generated-sleep-loop-v1\xingyuan-sleep-loop-alpha-v1.webm')
)

foreach ($required in $requiredSources) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required application source is missing: $required"
    }
}

New-Item -ItemType Directory -Path $buildRoot | Out-Null
Copy-Item -Path (Join-Path $electronDist '*') -Destination $buildRoot -Recurse -Force

$appRoot = Join-Path $buildRoot 'resources\app'
$previewTarget = Join-Path $appRoot 'preview'
$referenceTarget = Join-Path $appRoot 'reference'
$idleTarget = Join-Path $appRoot 'edit\animations\generated-idle-v1'
$activeTarget = Join-Path $appRoot 'edit\animations\generated-active-v1'
$sleepTarget = Join-Path $appRoot 'edit\animations\generated-sleep-v1'
$sleepLoopTarget = Join-Path $appRoot 'edit\animations\generated-sleep-loop-v1'
New-Item -ItemType Directory -Force -Path $previewTarget, $referenceTarget, $idleTarget, $activeTarget, $sleepTarget, $sleepLoopTarget | Out-Null

Copy-Item -LiteralPath (Join-Path $versionRoot 'app-package.json') -Destination (Join-Path $appRoot 'package.json') -Force
Copy-Item -LiteralPath (Join-Path $versionRoot 'NOTICE.md') -Destination $appRoot
Copy-Item -LiteralPath (Join-Path $versionRoot 'preview\pet.cjs') -Destination $previewTarget -Force
Copy-Item -LiteralPath (Join-Path $versionRoot 'preview\geometry.cjs') -Destination $previewTarget -Force
Copy-Item -LiteralPath (Join-Path $versionRoot 'preview\pet-preload.cjs') -Destination $previewTarget -Force
Copy-Item -LiteralPath (Join-Path $versionRoot 'preview\index.html') -Destination $previewTarget -Force
Copy-Item -LiteralPath (Join-Path $versionRoot 'preview\pet.css') -Destination $previewTarget -Force
Copy-Item -LiteralPath (Join-Path $versionRoot 'preview\pet.js') -Destination $previewTarget -Force
Copy-Item -LiteralPath (Join-Path $versionRoot 'preview\hit-test.js') -Destination $previewTarget -Force
foreach ($settingsFile in @('settings.html', 'settings.css', 'settings.js')) {
    Copy-Item -LiteralPath (Join-Path $versionRoot "preview\$settingsFile") -Destination $previewTarget
}
Copy-Item -LiteralPath (Join-Path $versionRoot 'preview\size.html') -Destination $previewTarget -Force
Copy-Item -LiteralPath (Join-Path $versionRoot 'preview\size.css') -Destination $previewTarget -Force
Copy-Item -LiteralPath (Join-Path $versionRoot 'preview\size.js') -Destination $previewTarget -Force
foreach ($quotaFile in @('quota.cjs', 'quota.html', 'quota.css', 'quota.js')) {
    Copy-Item -LiteralPath (Join-Path $versionRoot "preview\$quotaFile") -Destination $previewTarget
}
Copy-Item -LiteralPath (Join-Path $versionRoot 'reference\xingyuan-animation-master-v1.png') -Destination $referenceTarget -Force
Copy-Item -LiteralPath (Join-Path $versionRoot 'edit\animations\generated-idle-v1\xingyuan-idle-alpha-v1.webm') -Destination $idleTarget -Force
Copy-Item -LiteralPath (Join-Path $versionRoot 'edit\animations\generated-active-v1\xingyuan-active-alpha-v1.webm') -Destination $activeTarget -Force
Copy-Item -LiteralPath (Join-Path $versionRoot 'edit\animations\generated-sleep-v1\xingyuan-sleep-alpha-v1.webm') -Destination $sleepTarget -Force
Copy-Item -LiteralPath (Join-Path $versionRoot 'edit\animations\generated-sleep-loop-v1\xingyuan-sleep-loop-alpha-v1.webm') -Destination $sleepLoopTarget -Force

$electronExe = Join-Path $buildRoot 'electron.exe'
$appExe = Join-Path $buildRoot '星渊桌宠.exe'
Move-Item -LiteralPath $electronExe -Destination $appExe

foreach ($scriptName in @('pet.cjs', 'geometry.cjs', 'hit-test.js', 'pet-preload.cjs', 'pet.js', 'settings.js', 'size.js', 'quota.cjs', 'quota.js')) {
    $scriptPath = Join-Path $previewTarget $scriptName
    & node --check $scriptPath
    if ($LASTEXITCODE -ne 0) {
        throw "JavaScript syntax check failed: $scriptPath (exit code $LASTEXITCODE)"
    }
}

# Keep the complete previous app recoverable; never delete a working package
# before the replacement has passed syntax and required-resource checks.
$running = @(Get-Process -Name '星渊桌宠' -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.StartsWith($portableRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)
})
if ($running.Count) { throw "Close the current 星渊桌宠 before deployment. Staged build: $buildRoot" }
if (Test-Path -LiteralPath $portableRoot) { Move-Item -LiteralPath $portableRoot -Destination $backupRoot }
try { Move-Item -LiteralPath $buildRoot -Destination $portableRoot }
catch {
    if ((Test-Path -LiteralPath $backupRoot) -and -not (Test-Path -LiteralPath $portableRoot)) {
        Move-Item -LiteralPath $backupRoot -Destination $portableRoot
    }
    throw
}
$appExe = Join-Path $portableRoot '星渊桌宠.exe'
$appRoot = Join-Path $portableRoot 'resources\app'
$idleTarget = Join-Path $appRoot 'edit\animations\generated-idle-v1'
$activeTarget = Join-Path $appRoot 'edit\animations\generated-active-v1'
$sleepTarget = Join-Path $appRoot 'edit\animations\generated-sleep-v1'

$outputFiles = @(Get-ChildItem -LiteralPath $portableRoot -Recurse -File)
$outputBytes = ($outputFiles | Measure-Object -Property Length -Sum).Sum

[pscustomobject]@{
    Application = $appExe
    Exists = Test-Path -LiteralPath $appExe
    FileCount = $outputFiles.Count
    SizeMB = [math]::Round($outputBytes / 1MB, 1)
    Main = Join-Path $appRoot 'preview\pet.cjs'
    PreviousBuild = $backupRoot
    IdleAsset = Join-Path $idleTarget 'xingyuan-idle-alpha-v1.webm'
    ActiveAsset = Join-Path $activeTarget 'xingyuan-active-alpha-v1.webm'
    SleepAsset = Join-Path $sleepTarget 'xingyuan-sleep-alpha-v1.webm'
    SleepLoopAsset = Join-Path $appRoot 'edit\animations\generated-sleep-loop-v1\xingyuan-sleep-loop-alpha-v1.webm'
} | Format-List
