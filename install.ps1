# Installs the latest Mirador desktop app on Windows (x64), and starts it:
#
#   irm https://github.com/sodre90/mirador/releases/latest/download/install.ps1 | iex
#
# MIRADOR_DOWNLOAD_URL fetches the release's files from elsewhere.
#
# iex runs this in the PowerShell it was typed into, so all of it is one script block: its variables stay out of that
# session, and a failure ends the block rather than closing the window. A cut-off download leaves the block unclosed,
# so nothing runs.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $downloadUrl = if ($env:MIRADOR_DOWNLOAD_URL) { $env:MIRADOR_DOWNLOAD_URL } else { 'https://github.com/sodre90/mirador/releases/latest/download' }
  $setupArchive = 'Mirador-windows-x64-Setup.zip'
  $app = Join-Path $env:LOCALAPPDATA 'com.sodre90.mirador\stable\app'
  $launcher = Join-Path $app 'bin\launcher.exe'

  function Fail([string]$reason) { throw $reason }

  function Get-AppProcesses {
    @(Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith("$app\", [StringComparison]::OrdinalIgnoreCase) })
  }

  function Get-ReleaseFile([string]$name, [string]$path) {
    $url = "$downloadUrl/$name"
    Write-Host "Downloading $url"
    try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $path } catch { Fail "could not download $url" }
  }

  # Electrobun's installer waits for its Close button once it has installed, unless told to close itself.
  function Start-Installer([string]$installer) {
    $autoclose = $env:ELECTROBUN_INSTALLER_UI_AUTOCLOSE
    $env:ELECTROBUN_INSTALLER_UI_AUTOCLOSE = '1'
    try {
      $process = Start-Process -FilePath $installer -WorkingDirectory $env:USERPROFILE -PassThru
    } finally {
      $env:ELECTROBUN_INSTALLER_UI_AUTOCLOSE = $autoclose
    }
    $null = $process.Handle
    $process.WaitForExit()
    $process.ExitCode
  }

  function Test-Agent {
    $installed = @("$env:USERPROFILE\.local\bin\claude.exe", "$env:USERPROFILE\.opencode\bin\opencode.exe") | Where-Object { Test-Path $_ }
    (Get-Command claude, opencode, pi -ErrorAction SilentlyContinue) -or $installed
  }

  function Install-Mirador {
    $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ($architecture -ne 'AMD64') { Fail "Mirador's Windows app is built for x64, not $architecture." }
    if ((Get-AppProcesses).Count -gt 0) {
      Fail 'Mirador is running. Quit it from its tray icon, with Run host in the background off, then run this again.'
    }

    $work = Join-Path ([IO.Path]::GetTempPath()) "mirador-install-$([guid]::NewGuid().ToString('N'))"
    $keepWork = $false
    New-Item -ItemType Directory -Path $work | Out-Null
    try {
      Get-ReleaseFile $setupArchive "$work\setup.zip"
      Expand-Archive -LiteralPath "$work\setup.zip" -DestinationPath "$work\setup"
      $installer = "$work\setup\Mirador-Setup.exe"
      Write-Host 'Installing Mirador'
      $exitCode = Start-Installer $installer
      if ($exitCode -ne 0) {
        $keepWork = $true
        Fail "its installer failed (exit code $exitCode). Run $installer to see why."
      }
      if (-not (Test-Path $launcher)) { Fail "the installer finished, but $launcher is missing." }
      Write-Host "Installed Mirador in $app"
      # The installer starts the app before it exits.
      Write-Host 'Mirador is starting.'
    } finally {
      if (-not $keepWork) { Remove-Item -Recurse -Force -LiteralPath $work -ErrorAction SilentlyContinue }
    }

    if (-not (Test-Agent)) {
      Write-Host ''
      Write-Host 'Mirador runs Claude Code, opencode or pi, and none of them is installed yet. Claude Code installs with:'
      Write-Host '  irm https://claude.ai/install.ps1 | iex'
    }
  }

  try {
    Install-Mirador
  } catch {
    Write-Host "Mirador was not installed: $($_.Exception.Message)" -ForegroundColor Red
  }
}
