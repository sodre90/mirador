.DEFAULT_GOAL := help
SHELL := bash
DIST := $(CURDIR)/dist
SIGNING := $(DIST)/signing
MAC_ARCH := $(shell uname -m | sed 's/x86_64/x64/')
SHA256 := $(shell command -v sha256sum || echo shasum -a 256)
# Without --norsrc, ditto stores each file's extended attributes as a ._ entry, which plain unzip writes into the
# signed app as extra files, breaking its seal.
ZIP_APP := ditto -c -k --norsrc --keepParent
LINUX_HOST ?=
REMOTE_DIR ?= mirador-release
REMOTE_TMPDIR ?= $$HOME/mirador-release-tmp
VERSION ?=
FROM ?=
TAP_DIR ?=

.PHONY: help release publish tap macos macos-signed macos-staple linux linux-x64 linux-arm64 linux-remote update-files checksums cask clean

help: ## List the goals (builds take the committed files only)
	@grep -E '^[a-z0-9 -]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/' | awk -F'\t' '{printf "  make %-14s %s\n", $$1, $$2}'

release: ## Release VERSION=x.y.z up to a checked draft on GitHub (x.y.0 from main, starting the branch release/x.y.x; a patch from that branch): bump, gate, every build (Windows on GitHub Actions), update files, notes from dist/release-notes-VERSION.md (needs LINUX_HOST=user@host; the three builds run at once; FROM=step goes on from a failed step, FROM=step,step from the failed step of each build; WINDOWS=no leaves Windows out)
	LINUX_HOST=$(LINUX_HOST) WINDOWS=$(WINDOWS) bun scripts/release.ts release $(VERSION) $(FROM)

publish: ## Publish the draft of VERSION=x.y.z as the latest release
	bun scripts/release.ts publish $(VERSION)

tap: ## Push the Homebrew cask of the published VERSION=x.y.z to the tap in TAP_DIR (~/prj/homebrew-tap by default)
	TAP_DIR=$(TAP_DIR) bun scripts/release.ts tap $(VERSION)

macos: ## The macOS app with Mirador inside, zipped into dist/ (on a Mac)
	@[ "$$(uname -s)" = Darwin ] || { echo "make macos needs a Mac" >&2; exit 2; }
	cd desktop && bun install --frozen-lockfile && bun run build:release
	mkdir -p $(DIST) && rm -f $(DIST)/Mirador-macos-$(MAC_ARCH).zip
	$(ZIP_APP) desktop/build/stable-macos-$(MAC_ARCH)/Mirador.app $(DIST)/Mirador-macos-$(MAC_ARCH).zip

macos-signed: macos ## The macOS app signed with your Developer ID and notarized by Apple, zipped into dist/ (on a Mac whose keychain holds both)
	rm -rf $(SIGNING) && ditto -x -k $(DIST)/Mirador-macos-$(MAC_ARCH).zip $(SIGNING)
	bun desktop/scripts/sign-macos-app.ts $(SIGNING)/Mirador.app
	rm -f $(DIST)/Mirador-macos-$(MAC_ARCH).zip
	$(ZIP_APP) $(SIGNING)/Mirador.app $(DIST)/Mirador-macos-$(MAC_ARCH).zip

macos-staple: ## Finish make macos-signed once Apple accepted the submission it stopped waiting for
	bun desktop/scripts/sign-macos-app.ts --staple $(SIGNING)/Mirador.app
	rm -f $(DIST)/Mirador-macos-$(MAC_ARCH).zip
	$(ZIP_APP) $(SIGNING)/Mirador.app $(DIST)/Mirador-macos-$(MAC_ARCH).zip

linux: linux-x64 linux-arm64 ## Both Linux installers (or one: linux-x64, linux-arm64), built, installed and checked in containers, into dist/ (on an x64 Linux machine)

linux-x64 linux-arm64: linux-%:
	@[ "$$(uname -s)" = Linux ] || { echo "Build the Linux installers on an x64 Linux machine, as Electrobun's toolchain crashes in Docker on Apple Silicon; from a Mac: make linux-remote LINUX_HOST=user@host" >&2; exit 2; }
	MIRADOR_LINUX_ARCH=$* MIRADOR_LINUX_RELEASE=1 scripts/linux-desktop.sh
	mkdir -p $(DIST)
	cp "$${TMPDIR:-/tmp}/mirador-linux-desktop-$*-release/linux-$*-Mirador-Setup.tar.gz" $(DIST)/Mirador-linux-$*-Setup.tar.gz
	cp "$${TMPDIR:-/tmp}/mirador-linux-desktop-$*-release/"stable-linux-$*-* $(DIST)/

linux-remote: ## From a Mac: make linux on LINUX_HOST=user@host, both architectures at once, with the installers and update files copied back into dist/
	@[ -n "$(LINUX_HOST)" ] || { echo "Name the x64 Linux machine: make linux-remote LINUX_HOST=user@host" >&2; exit 2; }
	@[ -z "$$(git status --porcelain)" ] || echo "Uncommitted changes and files never added to git stay out of the build: sending HEAD ($$(git rev-parse --short HEAD))" >&2
	git bundle create - HEAD --tags | ssh $(LINUX_HOST) 'cat > $(REMOTE_DIR).bundle'
	ssh $(LINUX_HOST) 'set -e; bundle=$$(realpath $(REMOTE_DIR).bundle); mkdir -p $(REMOTE_DIR) $(REMOTE_TMPDIR); cd $(REMOTE_DIR); git init -q; git config core.ignorecase false; git fetch -q --force --tags "$$bundle" HEAD; rm -f "$$bundle"; git checkout -qf --detach FETCH_HEAD; git clean -qfdx -e /dist/; TMPDIR=$(REMOTE_TMPDIR) make -j2 --output-sync=target linux'
	mkdir -p $(DIST)
	rsync -a '$(LINUX_HOST):$(REMOTE_DIR)/dist/Mirador-linux-*-Setup.tar.gz' $(DIST)/
	rsync -a '$(LINUX_HOST):$(REMOTE_DIR)/dist/stable-linux-*' $(DIST)/

update-files: ## What the apps fetch to update themselves, with patches from the last 5 releases, into dist/, one build after another (on a Mac, after the builds)
	bun desktop/scripts/update-files.ts $(DIST)

checksums: $(DIST)/install.sh $(DIST)/install.ps1 ## install.sh and install.ps1 copied into dist/, and the SHA-256 of what dist/ holds, for the release notes
	@cd $(DIST) && shopt -s nullglob && $(SHA256) Mirador-* stable-* install.sh install.ps1

cask: ## The Homebrew cask for the sodre90/homebrew-tap tap, with the SHA-256 of the release's macOS zip and Linux installers, into dist/mirador.rb
	bun desktop/scripts/homebrew-cask.ts $(DIST)

$(DIST)/install.sh $(DIST)/install.ps1: $(DIST)/%: %
	@mkdir -p $(DIST) && cp $< $@

clean: ## Empty dist/
	rm -rf $(DIST)
