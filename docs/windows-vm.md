# Windows 11 ARM VM for `ci-win` (issue #427 Phase 4)

`ci-win` is a Woodpecker pipeline, and Woodpecker runs a pipeline only on an
**agent** that advertises the matching platform label. `ci-win` needs
`platform=windows/arm64`, so until a Windows machine runs
`woodpecker/agent-win.ps1` that pipeline stays **pending** and can't build the
Windows app.

This is the step-by-step to create that Windows machine as a free VM on your
Mac with [UTM](https://mac.getutm.app/). Budget a couple of hours the first
time (mostly Windows updates and the VS Build Tools download).

> **Why a VM at all?** The Windows app needs the MSVC toolchain and the
> WebView2 SDK — it cannot be cross-built from macOS. A VM on the Mac keeps it
> local and free (no GitHub Actions minutes).

## 0. Prerequisites

- Apple Silicon Mac, ~50 GB free disk, a decent internet connection.
- The Woodpecker server already running on the Mac (it is: `docker compose up -d`).
- UTM installed: `brew install --cask utm` (already done) — or
  [download it](https://mac.getutm.app/).

## 1. Create the Windows 11 VM

1. Open **UTM** → **+** (Create a New Virtual Machine).
2. Choose **Virtualize** → **Windows**. UTM offers to download Windows 11 ARM
   for you — accept it (it pulls the official Microsoft image and builds the
   installer automatically; ~10 GB).
3. Follow the Windows Setup wizard as usual:
   - "I don't have a product key" → choose **Windows 11 Pro** (or Home).
   - Pick the disk UTM provisioned and install.
4. Finish the Windows out-of-box setup (region, keyboard, account). A local
   account is fine.
5. In the VM window, mount/install **UTM Guest Tools** (toolbar → CD icon →
   _Install UTM Guest Tools_). This gives you the shared clipboard, better
   display scaling and USB passthrough. Reboot when asked.

## 2. Let Windows reach the Mac

The VM must reach the Woodpecker gRPC port (`9000`) on the Mac.

1. In the VM, open PowerShell and run `ipconfig`.
   - In UTM's default **Shared Network** mode the guest's **Default Gateway**
     is the Mac — note that IP (commonly `192.168.64.1`).
   - Or, in UTM → VM settings → **Network**, switch to **Bridged (Wi-Fi)** and
     the Mac is on your LAN instead (here: `192.168.1.210`).
2. Add a `host-mac` entry so the scripts work unchanged. In an **elevated**
   PowerShell (Run as Administrator):
   ```powershell
   Add-Content -Path C:\Windows\System32\drivers\etc\hosts -Value "192.168.64.1`thost-mac"
   # (use the IP you found above)
   ```
3. Verify the port is reachable — this must print `TcpTestSucceeded : True`:
   ```powershell
   Test-NetConnection host-mac -Port 9000
   ```
4. On the Mac, if the macOS firewall is on, allow incoming on `9000`.

## 3. Install the build toolchain inside Windows

The `ci-win` agent uses Woodpecker's **local** backend, so the tools run
directly in Windows (there is no Docker inside the VM).

Open a normal PowerShell and install everything with `winget`:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.22 -e
winget install --id Kitware.CMake -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Then pnpm, pinned to the version the repo expects:

```powershell
corepack enable
corepack prepare pnpm@10.16.1 --activate
```

Close and reopen PowerShell, then verify:

```powershell
git --version
node -v          # v22.x
cmake --version
pnpm -v          # 10.16.1
```

The WebView2 runtime ships with Windows 11, so no extra install is needed for
the desktop build (webview's CMake fetches the SDK).

## 4. Run the Windows agent

1. Copy the agent secret from the Mac — `woodpecker/.env`, the
   `WOODPECKER_AGENT_SECRET=` value. (Never commit it.)
2. Get `woodpecker/agent-win.ps1` into the VM — either clone the repo
   (`git clone https://github.com/pauloedspinho20/OpenAxe.git`), or just copy
   that one file over via the UTM shared clipboard.
3. Run it:
   ```powershell
   $env:WOODPECKER_VERSION = "v3.18.1"
   $env:WOODPECKER_AGENT_SECRET = "<paste the secret>"
   .\agent-win.ps1 -Server host-mac:9000
   ```
   The first run downloads `woodpecker-agent.exe` (~amd64, runs under Windows'
   x64 emulation).

## 5. Confirm it works

- The agent log ends with `starting Woodpecker agent` and no errors.
- In the Woodpecker UI (`http://localhost:8000` on the Mac) → **Agents** shows a
  `windows/arm64` agent as connected.
- The pending `ci/woodpecker/pr/ci-win` checks (on PR #444 / #445) now start
  running: `setup → drift → lint → build → unit → core → desktop`, and the
  `desktop` stage produces `apps/desktop/build/.../openaxe_desktop.exe` with the
  bundled UI.

## Gotchas

- **Don't `git submodule`-less:** the `setup` stage inits the DSP submodules
  and runs `pnpm install`, so the first run is slow.
- **CMake FetchContent needs internet** — webview, nlohmann/json and
  portable-file-dialogs are downloaded on configure.
- **Keep the UTM VM running** while you want Windows pipelines to execute;
  otherwise `ci-win` goes back to pending.
- For a persistent agent (survives reboots), register `agent-win.ps1` as a
  Windows service with [NSSM](https://nssm.cc/) or Task Scheduler.
