#!/bin/sh
# The first process of a room's VM, as root: lets the agents' user reach the sockets Mirador forwarded in, then runs
# the relays as nobody, with no capabilities and no way to gain any, for as long as the VM runs.
set -eu
chmod 666 /run/mirador/*.sock
exec setpriv --reuid=65534 --regid=65534 --clear-groups --inh-caps=-all --bounding-set=-all --no-new-privs -- \
  bun /mirador/sandbox/relays.mjs "$@"
