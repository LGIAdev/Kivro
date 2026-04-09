[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageDir
)

$ErrorActionPreference = 'Stop'

function Join-KivrioPackageParts {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDir,
        [Parameter(Mandatory = $true)]
        [string]$DestinationZip
    )

    $parts = Get-ChildItem -Path $SourceDir -Filter 'kivrio-package.zip.part*' | Sort-Object Name
    if (-not $parts) {
        $singleZip = Join-Path $SourceDir 'kivrio-package.zip'
        if (-not (Test-Path -LiteralPath $singleZip)) {
            throw "Archive Kivrio introuvable dans $SourceDir."
        }
        Copy-Item -LiteralPath $singleZip -Destination $DestinationZip -Force
        return
    }

    $buffer = New-Object byte[] (4MB)
    $output = [System.IO.File]::Open($DestinationZip, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    try {
        foreach ($part in $parts) {
            $input = [System.IO.File]::OpenRead($part.FullName)
            try {
                while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $output.Write($buffer, 0, $read)
                }
            }
            finally {
                $input.Dispose()
            }
        }
    }
    finally {
        $output.Dispose()
    }
}

function New-KivrioShortcut {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ShortcutPath,
        [Parameter(Mandatory = $true)]
        [string]$InstallDir,
        [Parameter(Mandatory = $true)]
        [string]$IconPath
    )

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
    $shortcut.Arguments = '"' + (Join-Path $InstallDir 'start-kivro-hidden.vbs') + '"'
    $shortcut.WorkingDirectory = $InstallDir
    $shortcut.IconLocation = $IconPath
    $shortcut.Save()
}

$scriptRoot = (Resolve-Path $PackageDir).Path
$installDir = Join-Path $env:LOCALAPPDATA 'Kivrio'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Kivrio.lnk'
$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Kivrio'
$startMenuShortcut = Join-Path $startMenuDir 'Kivrio.lnk'
$extractRoot = Join-Path $env:TEMP ('kivrio-install-' + [guid]::NewGuid().ToString('N'))
$resolvedZip = Join-Path $extractRoot 'kivrio-package.zip'
$packageRoot = Join-Path $extractRoot 'app'

try {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null
    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

    Join-KivrioPackageParts -SourceDir $scriptRoot -DestinationZip $resolvedZip
    Expand-Archive -Path $resolvedZip -DestinationPath $extractRoot -Force
    if (-not (Test-Path -LiteralPath $packageRoot)) {
        throw "Le package Kivrio est invalide: dossier app introuvable."
    }

    $null = robocopy $packageRoot $installDir /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) {
        throw "La copie des fichiers Kivrio a echoue (code $LASTEXITCODE)."
    }

    $dataDir = Join-Path $installDir 'data'
    $uploadsDir = Join-Path $dataDir 'uploads'
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    New-Item -ItemType Directory -Path $uploadsDir -Force | Out-Null

    $iconPath = Join-Path $installDir 'assets\kivrio.ico'
    if (-not (Test-Path -LiteralPath $iconPath)) {
        throw "Icone Kivrio introuvable apres installation."
    }

    New-KivrioShortcut -ShortcutPath $desktopShortcut -InstallDir $installDir -IconPath $iconPath
    New-KivrioShortcut -ShortcutPath $startMenuShortcut -InstallDir $installDir -IconPath $iconPath

    Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList @('"' + (Join-Path $installDir 'start-kivro-hidden.vbs') + '"')
}
finally {
    if (Test-Path -LiteralPath $extractRoot) {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
