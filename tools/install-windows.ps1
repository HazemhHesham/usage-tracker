param([switch]$DebugBuild)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectDirectory
try {
    # A Tauri build embeds the frontend, unlike `tauri dev`, which needs Vite.
    $buildArguments = @('run', 'tauri', 'build', '--', '--no-bundle')
    $buildProfile = 'release'
    if ($DebugBuild) {
        $buildArguments += '--debug'
        $buildProfile = 'debug'
    }
    & npm.cmd @buildArguments
    if ($LASTEXITCODE -ne 0) { throw 'The standalone Windows build failed.' }

    $sourceExecutable = Join-Path $projectDirectory "src-tauri\target\$buildProfile\usagebar.exe"
    if (-not (Test-Path -LiteralPath $sourceExecutable -PathType Leaf)) {
        throw "Build output not found: $sourceExecutable"
    }
    $installDirectory = Join-Path $env:LOCALAPPDATA 'UsageBar'
    $installedExecutable = Join-Path $installDirectory 'UsageBar.exe'
    New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
    Get-Process -Name usagebar -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $installedExecutable } |
        Stop-Process -PassThru |
        Wait-Process -Timeout 15
    Copy-Item -LiteralPath $sourceExecutable -Destination $installedExecutable -Force

    # Match the existing Launch at Login toggle, which uses the product name.
    $appName = (Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json).productName
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    if (-not (Test-Path -LiteralPath $runKey)) {
        New-Item -Path $runKey | Out-Null
    }
    $startupCommand = '"' + $installedExecutable + '" --startup'
    New-ItemProperty -Path $runKey -Name $appName -Value $startupCommand -PropertyType String -Force | Out-Null

    $approvedKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
    if (Test-Path -LiteralPath $approvedKey) {
        New-ItemProperty -Path $approvedKey -Name $appName -PropertyType Binary `
            -Value ([byte[]](2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)) -Force | Out-Null
    }
    if ((Get-ItemPropertyValue -Path $runKey -Name $appName) -ne $startupCommand) {
        throw 'Windows startup registration could not be verified.'
    }
    Start-Process -FilePath $installedExecutable -ArgumentList '--startup'
    Write-Output "Installed: $installedExecutable"
    Write-Output 'Launch at Login enabled for the current Windows user.'
    Write-Output 'UsageBar starts with the meter visible and dashboard hidden.'
} finally {
    Pop-Location
}
