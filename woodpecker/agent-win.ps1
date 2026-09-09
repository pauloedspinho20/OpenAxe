# Windows agent (UTM Windows 11 ARM VM, Local backend) — runs ci-win.yml.
# Run inside the VM. Prereqs: git, Node 22, pnpm 10.16.1, CMake, VS Build Tools.
# Auth via WOODPECKER_AGENT_SECRET env; label via --labels (v3 CLI).
# If flags differ on your version, run: .\woodpecker-agent.exe --help
# For a persistent service, register this via nssm or Task Scheduler (Phase 4).
param(
  [string]$Version = $env:WOODPECKER_VERSION,
  [string]$Server = "host-mac:9000"
)
$ErrorActionPreference = "Stop"
if (-not $Version) { $Version = "v3.18.1" }
if (-not $env:WOODPECKER_AGENT_SECRET) { throw "set WOODPECKER_AGENT_SECRET (same value as server .env)" }

# No windows_arm64 binary upstream — the amd64 exe runs via x64 emulation
# on Win11 ARM, which is fine for orchestrating builds (not DSP).
$BinDir = "$env:USERPROFILE\.woodpecker\bin"
$Bin = "$BinDir\woodpecker-agent.exe"
if (-not (Test-Path $Bin)) {
  New-Item -ItemType Directory -Force $BinDir | Out-Null
  $Zip = "$env:TEMP\woodpecker-agent.zip"
  Invoke-WebRequest -OutFile $Zip `
    -Uri "https://github.com/woodpecker-ci/woodpecker/releases/download/$Version/woodpecker-agent_windows_amd64.zip"
  Expand-Archive -Path $Zip -DestinationPath $BinDir -Force
  Remove-Item $Zip
}

# $Server must resolve to the Mac from inside the VM (UTM shared-network
# host IP, or a hosts entry `host-mac`). Verify with: Test-NetConnection host-mac -Port 9000
& $Bin --server $Server --labels platform=windows/arm64 --backend-engine local
