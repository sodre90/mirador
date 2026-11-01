# The Linux machine scripts/linux-test.sh runs Mirador's checks on: Bun, Node (for the Playwright runner and pi), Claude
# Code, opencode, pi, Playwright's Chromium, and WebKitGTK with a virtual display, the Linux desktop app's engine, which
# e2e/canvas-webkitgtk.spec.ts shows canvas pages in. As a non-root user because Claude Code refuses to skip permission
# prompts as root.
FROM ubuntu:24.04

# .bun-version names the Bun, which build_image passes in.
ARG BUN_VERSION
ARG NODE_VERSION=22.23.3
ARG OPENCODE_VERSION=2.0.27
ARG CLAUDE_CODE_VERSION=2.1.289
ARG PI_VERSION=1.3.0
ARG PLAYWRIGHT_VERSION=1.63.0

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl fish git openssl unzip xz-utils && rm -rf /var/lib/apt/lists/*
RUN arch=$(dpkg --print-architecture | sed 's/amd64/x64/') \
 && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" | tar -xJ -C /usr/local --strip-components=1 \
 && npm install --global "@earendil-works/pi-coding-agent@${PI_VERSION}" && npm cache clean --force

USER ubuntu
WORKDIR /home/ubuntu
ENV PATH=/home/ubuntu/.bun/bin:/home/ubuntu/.opencode/bin:/home/ubuntu/.local/bin:$PATH
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
 && curl -fsSL https://opencode.ai/v2/install | bash -s -- --version "${OPENCODE_VERSION}" --no-modify-path \
 && curl -fsSL https://claude.ai/install.sh | bash -s "${CLAUDE_CODE_VERSION}" \
 && mkdir -p .bun/install/cache

USER root
RUN /home/ubuntu/.bun/bin/bunx playwright@${PLAYWRIGHT_VERSION} install-deps chromium webkit && rm -rf /var/lib/apt/lists/*

USER ubuntu
RUN bunx playwright@${PLAYWRIGHT_VERSION} install chromium webkit

USER root
RUN apt-get update && apt-get install -y --no-install-recommends libwebkit2gtk-4.1-0 xvfb xauth && rm -rf /var/lib/apt/lists/*
USER ubuntu
