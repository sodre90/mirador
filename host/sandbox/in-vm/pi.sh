#!/bin/sh
# pi in a sandbox's VM, as pi-acp starts it for each session: on the models.json and settings.json Mirador gives it,
# which reach the model through Mirador's proxy with no key in the VM. They are written as the agent user, in the VM,
# so a link the agents left in their folder leads only to what the VM sees; Mirador never writes in that folder itself.
# Each is renamed into place whole, so a pi starting beside this one never reads half of it.
set -eu
mkdir -p "$PI_CODING_AGENT_DIR"
given() {
  printf '%s' "$2" > "$PI_CODING_AGENT_DIR/.$1.$$"
  mv -f "$PI_CODING_AGENT_DIR/.$1.$$" "$PI_CODING_AGENT_DIR/$1"
}
given models.json "$MIRADOR_PI_MODELS"
given settings.json "$MIRADOR_PI_SETTINGS"
unset MIRADOR_PI_MODELS MIRADOR_PI_SETTINGS
exec /usr/local/bin/pi "$@"
