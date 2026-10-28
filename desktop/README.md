# Mirador desktop app

Mirador in a window of its own, with a menu bar item on macOS and a tray icon on Linux and Windows. It starts the Mirador host for you, keeps it running while the window is closed, opens at login and shows Mirador's notifications natively.

The app adds no server of its own: the UI and the host are Mirador's `bun host/main.ts`. A release build carries its own copy of Mirador and the Bun it runs on, so it needs neither Bun nor a checkout. A build of your own runs your checkout instead.

- [Install on macOS](#install-on-macos)
- [Install on Linux](#install-on-linux)
- [Install on Windows](#install-on-windows)
- [Install a build of your own](#install-a-build-of-your-own)
- [Using it](#using-it)
- [Uninstall](#uninstall)
- [Build and release](#build-and-release)
- [Known limits](#known-limits)

## Install on macOS

For Macs with Apple Silicon.

```bash
curl -fsSL https://github.com/sodre90/mirador/releases/latest/download/install.sh | sh
```

The script puts `Mirador.app` where it already is, else in `~/Applications`, which needs no admin rights, and opens it. Run it again to update; quit Mirador first.

**By hand**: download `Mirador-macos-arm64.zip` from the [releases](https://github.com/sodre90/mirador/releases). The app is signed with a Developer ID and notarized by Apple:

```bash
ditto -x -k Mirador-macos-arm64.zip ~/Applications
open ~/Applications/Mirador.app
```

On first launch macOS asks whether Mirador may send notifications. It asks again the first time the terminal or an agent reaches a machine on your local network, and the first time you dictate ([Microphone](#microphone)).

## Install on Linux

For x64 and arm64, on X11 or Wayland desktops (only X11 is tested so far), with glibc 2.36 or newer (Ubuntu 24.04, Debian 12, Fedora 37 or later).

```bash
curl -fsSL https://github.com/sodre90/mirador/releases/latest/download/install.sh | sh
```

The script installs the libraries the app needs with `sudo apt-get` or `sudo dnf`, then the app for your user, and starts it. Run it again to update; quit Mirador first.

**By hand**: the app needs GTK 3, WebKitGTK 4.1 and the Ayatana AppIndicator library. Electrobun links the last one directly, so the app doesn't start without it, even on a desktop with no tray.

```bash
sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2   # Debian, Ubuntu
sudo dnf install gtk3 webkit2gtk4.1 libayatana-appindicator-gtk3 librsvg2              # Fedora
```

Then download `Mirador-linux-x64-Setup.tar.gz` or `Mirador-linux-arm64-Setup.tar.gz` from the [releases](https://github.com/sodre90/mirador/releases) (`uname -m` says which: `x86_64` or `aarch64`) and run its installer:

```bash
mkdir mirador-setup && tar -xzf Mirador-linux-*-Setup.tar.gz -C mirador-setup && mirador-setup/installer
```

The app goes in `~/.local/share/com.sodre90.mirador/stable/app/`, and *Mirador* in your applications menu (`~/.local/share/applications/Mirador.desktop`). The installer starts it; later, start it from there.

Notifications go through `notify-send`: install `libnotify-bin` (Debian, Ubuntu) or `libnotify` (Fedora) to get them. Stock GNOME shows no tray icons until you add the AppIndicator extension (`gnome-shell-extension-appindicator` on Fedora); the app's menu is also under *Desktop app…* at the bottom of Mirador's sidebar.

## Install on Windows

For x64. Windows support is experimental: expect rough edges, and please report what breaks. In PowerShell:

```powershell
irm https://github.com/sodre90/mirador/releases/latest/download/install.ps1 | iex
```

The script installs the app for your user in `%LOCALAPPDATA%\com.sodre90.mirador\stable\app\`, and starts it. Run it again to update; quit Mirador from its tray icon first, with *Run host in the background* off.

**By hand**: download `Mirador-windows-x64-Setup.zip` from the [releases](https://github.com/sodre90/mirador/releases), extract it and run `Mirador-Setup.exe`. The app is not signed yet, so SmartScreen warns when the installer first runs: *More info*, then *Run anyway*. The installer installs without a click, then waits at "Installation complete" for *Close*, and starts Mirador.

## Install a build of your own

A build of your own runs the host from your checkout, with the Bun you built it with (see [Settings](#settings)). See [Build and release](#build-and-release) for building it.

**macOS**:

```bash
ditto "<repo>/desktop/build/stable-macos-arm64/Mirador.app" ~/Applications/Mirador.app
open ~/Applications/Mirador.app
```

Copied with `ditto`, the app carries no quarantine flag. Launch it by its path, not `open -a "Mirador"`: the dev and stable build folders hold apps with the same identifier, and *Open at login* registers the path the app was launched from.

**Linux**, after the libraries above:

```bash
tar -xzf desktop/artifacts/linux-*-Mirador-Setup.tar.gz -C /tmp && /tmp/installer
```

Then start *Mirador* from your applications menu once, so *Open at login* registers the installed copy.

## Using it

### On macOS and on Linux

| | macOS | Linux |
| --- | --- | --- |
| The app's menu | A menu bar item, with the number of conversations waiting for you next to it and as a badge on the Dock icon | A tray icon, with a red dot while a conversation needs you or failed and a green one while one is done, and *Desktop app…* in Mirador's sidebar |
| Closing the window | The app stays in the menu bar; its Dock icon hides until the window comes back | The app keeps running; *Open* in the tray, or launching it again, brings the window back |
| Launching it again | Brings the window back | Hands over to the running app (through `<data dir>/desktop-<port>.sock`) and quits |
| Quit | The menu, or ⌘Q while the window is focused | The tray menu or *Desktop app…* |
| Open at login (on by default) | A LaunchAgent, `com.sodre90.mirador.open-at-login.<port>` | An XDG autostart entry, `~/.config/autostart/mirador-<port>.desktop` |
| Run host in the background | A LaunchAgent, `com.sodre90.mirador.host.<port>` (RunAtLoad, KeepAlive), driven with `launchctl` | A systemd user service, `~/.config/systemd/user/mirador-host-<port>.service` (`Restart=always`, enabled so it starts at login), driven with `systemctl --user`; without a systemd user session it refuses and says why |
| Notifications | Native; macOS asks once, and System Settings › Notifications changes it later | Through `notify-send`; without it there are none, and the app's output says `notify-send failed` |
| Theme | The whole app takes Mirador's theme: title bar, dialogs and canvas pages | Left as GTK draws it |

The menu has the Mirador version and the host's status, a newer version when there is one, *Open*, *Restart host*, *Run host in the background*, *Open at login* and *Quit*.

### How the host is handled

On launch the app checks whether something already answers on the port.

| Situation | What the app does |
| --- | --- |
| A host answers that the app did not start | Uses it, and never stops it. *Restart host* is disabled, with the reason. |
| A host the app started earlier still runs (its pid in `<data dir>/desktop-host.pid`, command line checked) | Takes it over as its own. |
| Nothing answers | Starts `bun host/main.ts` detached, through your login shell (`$SHELL -ilc`), so the host sees the same environment as a terminal. Its output goes to `<data dir>/logs/host.log`, its pid to `desktop-host.pid`. |
| *Run host in the background* is on | The host runs as the LaunchAgent or systemd service above, and the app only talks to it through `launchctl` or `systemctl --user`. |

The LaunchAgents and services carry no environment values, as the login shell supplies the environment. A non-default port or data directory is passed as plain `MIRADOR_*=value` arguments, so a default install has none.

On Windows:

- **The app's own host** starts on Bun itself, with no shell, and ends with the app.
- **Run host in the background** is a scheduled task of your account, `Mirador-host-<port>-<your SID>`, which starts at login. It runs `<data dir>\host-task.cmd`, which sets the environment and starts the host, in a console that shows no window. The host writes its pid to `<data dir>\background-host.pid`, and the app stops it with Ctrl-C. Before an update, the app stops a background host that runs the app's own copy, as Windows does not let an update replace a folder a program works in; the app starts it again after the update.
- **Open at login** is a value, `Mirador-<port>`, in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, naming the launcher. The launcher drops its arguments, so this is only available on the default port and data folder.
- **Restart host**: Windows cannot re-execute a process, so the host restarts by exiting. The app starts its own host again, and a background host runs its task again before it exits.

### Closing and quitting

- **Closing the window** stops nothing. ⌘W closes what has focus inside Mirador first (the open dialog, else the focused terminal's shell), and asks before it closes the window; the window's close button doesn't ask.
- **Quit** stops the host only if the app started it. A host started by `bun host/main.ts` in a terminal, or one running in the background, keeps running.
- **Run host in the background** refuses to turn on, with the reason, while a host the app does not own answers. Turning it on stops a host the app started, so the background one can take the port.

### Notifications

The app listens to the host for the notifications a browser tab would show (a question, a permission request, a finished turn or an error, in a conversation not on screen in a focused window) and shows them natively, also while its window is closed. It reconnects whenever the host restarts. While it listens, browser tabs on this computer show none, so nothing arrives twice.

### Microphone

Dictating into the message box (Settings › Voice) uses the microphone. The first time you dictate after the app starts, the app asks whether the page may use it:

| | The app asks | Then |
| --- | --- | --- |
| macOS | *Microphone Access*: Allow or Block | The first time, macOS asks as well; System Settings › Privacy & Security › Microphone changes that later |
| Linux | *Camera & Microphone Access*: Allow or Block | |
| Windows | *Camera & Microphone Access*: Yes or No | Windows Settings › Privacy & security › Microphone must let desktop apps use it |

The app keeps the answer while it runs, for a day at most, so a Block holds until you quit it.

### Settings

`<data dir>/desktop.json` (by default `~/.mirador/desktop.json`), written with defaults on first launch:

```json
{
  "hostDirectory": "<repo path at build time>, or null in a release build",
  "bun": "<absolute bun path at build time>, or null in a release build",
  "hostRunsInBackground": false,
  "openAtLogin": true
}
```

- `hostDirectory`: the checkout the host runs from; null for the copy of Mirador the app carries.
- `bun`: the Bun that runs the host; null for the app's own.
- `hostRunsInBackground` and `openAtLogin` are switched from the app's menu; edit the file only while the app is quit.

The data directory, port and canvas port follow the host's own environment variables: `MIRADOR_DATA_DIR`, `MIRADOR_PORT` and `MIRADOR_CANVAS_PORT` (by default `~/.mirador`, 4600, and the port after it).

## Uninstall

Replace `4600` with your port if you changed it. Your conversations and canvases in `~/.mirador` stay.

**Installed with Homebrew**: `brew uninstall --cask mirador` quits the app and removes it with its open at login entry, and on macOS the background host too. On Linux, turn off *Run host in the background* in the tray menu first. `brew uninstall --zap --cask mirador` also removes the app's window data.

**macOS**: turn off the background host and open at login, quit the app from the menu bar, and delete it:

```bash
launchctl bootout gui/$(id -u)/com.sodre90.mirador.host.4600 2>/dev/null
launchctl bootout gui/$(id -u)/com.sodre90.mirador.open-at-login.4600 2>/dev/null
rm -f ~/Library/LaunchAgents/com.sodre90.mirador.host.4600.plist ~/Library/LaunchAgents/com.sodre90.mirador.open-at-login.4600.plist
rm -rf ~/Applications/Mirador.app ~/Library/Application\ Support/com.sodre90.mirador   # or /Applications/Mirador.app
rm -f ~/.mirador/desktop.json ~/.mirador/desktop-host.pid ~/.mirador/logs/host.log
```

**Linux**: quit the app, then:

```bash
systemctl --user disable --now mirador-host-4600.service 2>/dev/null
rm -f ~/.config/systemd/user/mirador-host-4600.service ~/.config/autostart/mirador-4600.desktop
systemctl --user daemon-reload
~/.local/share/com.sodre90.mirador/stable/uninstall --quiet   # Electrobun's uninstaller: the app and its menu entry
rm -f ~/.mirador/desktop.json ~/.mirador/desktop-host.pid ~/.mirador/desktop-4600.sock ~/.mirador/logs/host.log
```

**Windows**: turn off *Run host in the background* and *Open at login* in the tray menu, as uninstalling doesn't remove them yet. Quit the app, then uninstall Mirador in *Settings › Apps › Installed apps*.

## Build and release

Built with [Electrobun](https://electrobun.dev) 2.0.2 (pinned). Electrobun doesn't cross-compile, so build on the system the app is for. Bun must be on your `PATH` at build time, in the version `.bun-version` names for a release build, and a build of your own bakes its absolute path and the checkout's in as defaults (see [Settings](#settings)).

```bash
cd desktop
bun install
bun run typecheck
bun run build:dev      # build/dev-macos-arm64/Mirador-dev.app
bun run build          # build/stable-macos-arm64/Mirador.app, or artifacts/linux-*-Mirador-Setup.tar.gz
bun run build:release  # the same, carrying Mirador (about 160 MB), for people without a checkout
bun run dev            # run from source with Electrobun's dev runner
```

The release assets are built from the repository root with `make` (`make help` lists the goals, and the main README's *Develop* section has the steps).

### What a release build carries

`build:release` stages the committed `host`, `web`, `shared` and `bin` files, with their production dependencies, in `release/mirador` (`scripts/stage-mirador.ts`). The app carries them in `Contents/Resources/app/mirador` on macOS and `Resources/app/mirador` on Linux and Windows, runs that copy on the Bun inside it, and the `mirador` command its agents run uses the same Bun. The dependencies are this machine's, which is one more reason to build on the platform the app is for.

On Linux the payload is written as POSIX ustar (`TAR_OPTIONS=--format=ustar`): GNU tar's default writes `node_modules`' long paths as long-name entries, which Electrobun's Linux installer refuses with `TarUnsupportedFileType`.

On macOS, Electrobun builds the stable app as a self-extracting stub, and `scripts/unwrap-macos-app.sh` unwraps it right after the build, so `build/stable-macos-arm64/Mirador.app` is the expanded app and the release zip carries that. macOS runs a quarantined download translocated, on a read-only mount, where the stub's own first-launch expansion fails and the app hangs with no window. The expanded app needs nothing from its bundle at launch; Electrobun's uninstall manifest is written on the user's machine (`~/Library/Application Support/com.sodre90.mirador/stable/`) when the app first runs there.

The Windows release is built on GitHub's Windows runner by `.github/workflows/windows-release.yml`, which `make release` starts. It is not signed yet, so SmartScreen warns when `Mirador-Setup.exe` first runs: *More info*, then *Run anyway*. The installer installs without a click, then waits at "Installation complete" for *Close*.

Stable builds are signed ad hoc by Electrobun's own signing step (`ELECTROBUN_DEVELOPER_ID=-`, unless you set a real identity), which macOS needs before it asks to allow notifications. They are not notarized; the release's app is, through `make macos-signed`.

`make macos-signed` (repository root) signs the release build with your Developer ID instead and has Apple notarize it, so a download opens without clearing its quarantine. It needs the *Developer ID Application* certificate in the login keychain, and the notary key stored in the login keychain with `xcrun notarytool store-credentials mirador-notary --keychain ~/Library/Keychains/login.keychain-db`, which, unlike the default data-protection keychain, stays readable while the screen is locked. `desktop/scripts/sign-macos-app.ts` signs every program and library in the app, the deepest first, with the hardened runtime and `desktop/entitlements.plist` (the JIT exceptions Bun's own release is signed with), checks that the signed Bun still runs JavaScript, submits the app and staples Apple's ticket to it. Apple can take more than an hour, most of all with a new team's first submissions: when the two-hour wait runs out, `make macos-staple` finishes once `xcrun notarytool info <id> --keychain-profile mirador-notary --keychain ~/Library/Keychains/login.keychain-db` says Accepted.

### Update files

A release build updates itself from the latest release, on macOS only when it is signed with a Developer ID: Electrobun's updater fetches `<channel>-<platform>-<arch>-update.json` from `releases/latest/download`, then a patch from the build it runs, or the whole archive when the release has none. `make update-files` (repository root, on a Mac, after `make macos-signed` and `make linux-remote`) writes these files into `dist/` with `desktop/scripts/update-files.ts`:

- For macOS it packs the signed, stapled app in `dist/signing` again, as Electrobun packs its own archive before the app is signed. It refuses an app Apple has not accepted yet. Like Electrobun's archive it is POSIX ustar, without extended attributes.
- The Linux archives are Electrobun's own, which `make linux` brings back with the installers.
- For each platform, it makes a patch from each of the last 5 releases that carry update files, with Electrobun's `bsdiff`, against the archive that release published: an installed app keeps that archive, and only a patch made from those exact bytes applies to it. Each patch is checked by rebuilding this build's archive from it.

`make release` makes each platform's as soon as its build is in (`update-files.ts <dist> --platform macos|linux|win`), one platform at a time, as `bsdiff` takes many times an archive's size in memory.

Upload every file it writes with the release, under the same names, in this order: `releases/latest/download` follows the newest published release, so installed apps see a release the moment it is published.

1. Run `make update-files` before the new release exists. A release already published would take one of the five places.
2. Create the release as a draft, with the installers, `install.sh`, `install.ps1` and every update file.
3. Publish it.

The release build's `baseUrl` is set at build time, so an app from before it cannot update itself.

### Linux builds in containers

`scripts/linux-desktop.sh` (repository root, needs Docker) builds the installer in an Ubuntu 24.04 container, installs it there and checks the app on a virtual display: the host answers, it opens at login and stays single-instance. `MIRADOR_LINUX_ARCH=x64` or `arm64` picks the architecture. Its installer has the container's paths baked in, so it is a test artifact, not one to hand out.

`MIRADOR_LINUX_RELEASE=1` builds the one to hand out instead, the release's `*-Setup.tar.gz`. It takes the committed files only, so run it from the main checkout or a clone, as the container clones it. It carries Mirador with Linux dependencies, and the checks also see its host run that copy.

Docker Desktop on a Mac runs only arm64 here, and not the release build: Electrobun 2.0.2's toolchain (cottontail 0.7.1) dies with SIGILL in Apple Silicon's Linux VM. So build both release installers on an x64 Linux machine (Podman works too), arm64 emulated through qemu with `MIRADOR_LINUX_ARCH=arm64`.

### Icons

`assets/app-icon.svg` (the app icon) and `assets/tray-icon.svg` (the menu bar icon, drawn black and shown by macOS as a template image) are the sources. `scripts/render-icons.sh` renders `icon.iconset/`, `assets/tray-icon.png` and the tray icons with a waiting dot (`assets/tray-icon-needs-you.png`, `assets/tray-icon-done.png`) from them; run it again after editing either. The page's favicon is `web/favicon.svg`.

### Tests

The logic lives in `src/core`, with no Electrobun imports, and is tested from the repository root:

```bash
bun run typecheck
bun run test            # includes tests/desktop-*.test.ts
```

## Known limits

- **macOS file access prompts**: macOS attributes file access to the app, not to Terminal. As the host starts through your interactive login shell, anything your `~/.zshrc` touches under `~/Downloads`, `~/Documents` or `~/Desktop` brings a one-time permission prompt for Mirador, and the host waits on it until you answer. Approve it once.
- **Clicking a notification** doesn't open its conversation: Electrobun 2.0.2 does not report clicks.
- **The macOS theme** is set through the Objective-C runtime (`src/bun/app-appearance.ts`), as Electrobun 2.0.2 has no call for it. Whether WebKitGTK renders canvas pages in the app's appearance on Linux is untested, so the Linux app is left as it is.
- **Linux** is checked only under X11 (Xvfb with openbox); the tray icon and Wayland sessions are untested.
- **The microphone question** comes again each time the app starts, as Electrobun 2.0.2 keeps the answer in memory only. On Windows, `build.win.autoGrantPermissions: ["microphone"]` in `electrobun.config.ts` would skip it, but for any page the window opens, so it is left off. No real microphone has been tried in the app yet: on Linux, recording is checked only in a bare WebKitGTK page with its mock microphone, and Windows is untested.
- **Sign-in**: `host.log` holds no sign-in link, as the host prints one only to a terminal. The window signs in with `<data dir>/browser-token`, which the app never logs. The window is sandboxed, and links to other sites open in your default browser.
