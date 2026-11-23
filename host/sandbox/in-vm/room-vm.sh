#!/bin/sh
# The first process of a room's VM, for as long as it runs: the relays, as nobody, with no capabilities and no way to
# gain any, so the agents' user can neither signal nor trace them. usage: room-vm.sh root|nobody <port>=<socket> ...
# root: started as root, as Apple's container does; lets the agents' user reach the sockets Mirador forwarded in, then
#   drops to nobody.
# nobody: started as nobody, as Podman does, where Mirador lets nobody reach its sockets itself.
set -eu
started_as=${1:-}
[ $# -gt 0 ] && shift
case "$started_as" in
  root)
    chmod 666 /run/mirador/*.sock
    exec setpriv --reuid=65534 --regid=65534 --clear-groups --inh-caps=-all --bounding-set=-all --no-new-privs -- \
      bun /mirador/sandbox/relays.mjs "$@"
    ;;
  nobody)
    if [ "$(id -u)" != 65534 ]; then
      echo "room-vm.sh: started as uid $(id -u), not nobody: the relays run only as nobody" >&2
      exit 1
    fi
    exec bun /mirador/sandbox/relays.mjs "$@"
    ;;
  *)
    echo "usage: room-vm.sh root|nobody <port>=<socket> ..." >&2
    exit 2
    ;;
esac
