# The image a sandbox's agents of one kind run in, built on the owner's computer on first use. The build gets no files of
# this computer: on Docker Hub's official Node image, git, ripgrep and fd from Debian, and Bun and the agent from npm.
FROM docker.io/library/node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates ripgrep fd-find \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'
ARG BUN_VERSION
ARG AGENT_PACKAGE
ARG AGENT_PROGRAM
RUN npm install -g bun@${BUN_VERSION} ${AGENT_PACKAGE} && npm cache clean --force && bun --version && PI_OFFLINE=1 ${AGENT_PROGRAM} --version
RUN find / -xdev -perm /6000 -type f -exec chmod a-s {} +
LABEL mirador.agent=${AGENT_PACKAGE}
ENV DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 PI_OFFLINE=1
