# The image a sandbox's VM runs on where its owner named none: Debian, with git and what agents search with. Built on
# this computer on first use, from no files of it; Mirador's guard, Bun and the agents come in from its tools folder as
# the VM starts. No program keeps its setuid or setgid bit, behind the no-new-privileges every agent runs with.
FROM docker.io/library/debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates ripgrep fd-find \
 && rm -rf /var/lib/apt/lists/* \
 && find / -xdev -perm /6000 -type f -exec chmod a-s {} +
