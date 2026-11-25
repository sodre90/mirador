#!/bin/sh
# What a room's VM runs, as root, for as long as it runs: lets the agents' user reach the sockets Mirador forwarded in,
# then runs the relays as nobody, with no capabilities and no way to gain any, so the agents' user can neither signal nor
# trace them. usage: room-vm.sh <port>=<socket> ...
set -eu
chmod 666 /run/mirador/*.sock
exec setpriv --reuid=65534 --regid=65534 --clear-groups --inh-caps=-all --bounding-set=-all --no-new-privs -- \
  bun /mirador/sandbox/relays.mjs "$@"
