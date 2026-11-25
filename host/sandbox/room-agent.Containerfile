# The image a sandbox's agents of one kind run in, built on the owner's computer on first use. The build gets no files of
# this computer: on Docker Hub's official Node image, git, ripgrep, fd and what Mirador's guard runs on from Debian, and
# Bun and the agent from npm. The guard is compiled in a first stage from its source, which comes as an argument, as
# Apple's builder shows a build none of a folder under the temporary one.
FROM docker.io/library/node:22-bookworm-slim AS guard
RUN apt-get update \
 && apt-get install -y --no-install-recommends g++ libfuse3-dev libutf8proc-dev pkg-config
ARG GUARD_SOURCE
RUN mkdir /guard \
 && node -e 'for (const [name, text] of Object.entries(JSON.parse(zlib.gunzipSync(Buffer.from(process.env.GUARD_SOURCE, "base64"))))) fs.writeFileSync(`/guard/${name}`, text)'
RUN g++ -std=c++17 -O2 -D_FILE_OFFSET_BITS=64 /guard/guard.cpp -o /mirador-guard $(pkg-config --cflags --libs fuse3 libutf8proc) -lpthread

FROM docker.io/library/node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates ripgrep fd-find libfuse3-3 libutf8proc2 \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'
COPY --from=guard /mirador-guard /usr/local/bin/mirador-guard
ARG BUN_VERSION
ARG AGENT_PACKAGE
ARG AGENT_PROGRAM
RUN npm install -g bun@${BUN_VERSION} ${AGENT_PACKAGE} && npm cache clean --force && bun --version && PI_OFFLINE=1 ${AGENT_PROGRAM} --version
RUN find / -xdev -perm /6000 -type f -exec chmod a-s {} +
LABEL mirador.agent=${AGENT_PACKAGE}
ENV DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 PI_OFFLINE=1
