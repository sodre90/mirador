# The image a sandboxed room's agents run in, built on the owner's Mac on first use. The build gets no files of this
# computer: on Docker Hub's official Node image, git from Debian, and Bun and Claude Code from npm.
FROM docker.io/library/node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'
ARG BUN_VERSION
ARG CLAUDE_CODE_VERSION
RUN npm install -g bun@${BUN_VERSION} @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force && bun --version && claude --version
RUN find / -xdev -perm /6000 -type f -exec chmod a-s {} +
LABEL mirador.claude-code=${CLAUDE_CODE_VERSION}
ENV DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
