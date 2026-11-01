# Running the push relay

```sh
podman build -f push-relay/Containerfile -t mirador-push-relay .
mkdir -p ~/mirador-push-relay/{data,secrets}   # secrets: mode 700, its files mode 600
```

The relay runs as uid 1000 (`bun`); `--userns=keep-id:uid=1000,gid=1000` maps the owner's user to
it, so the relay can write `data/tokens` and read the mode-600 secrets the owner put in place.
Leave out the `APNS_*` or `FCM_*` variables to turn that side off. `--init` lets the relay stop
at once on SIGTERM; bun doesn't when it runs as the container's first process.

## Behind a TLS proxy you already run

Publish the relay on the machine's LAN address and have the proxy pass `push.example.com` to it:

```sh
podman run -d --init --name mirador-push-relay --restart=always --userns=keep-id:uid=1000,gid=1000 \
  -p <lan address>:8790:8790 \
  -v ~/mirador-push-relay/data:/data:Z -v ~/mirador-push-relay/secrets:/secrets:ro,Z \
  -e APNS_KEY_FILE=/secrets/apns.p8 -e APNS_KEY_ID=… -e APNS_TEAM_ID=… -e APNS_TOPIC=… \
  -e FCM_SERVICE_ACCOUNT_FILE=/secrets/firebase.json \
  mirador-push-relay
```

For nginx, a `server` block for `push.example.com` on 443 with its certificate,
`client_max_body_size 16k;` and `location / { proxy_pass http://<lan address>:8790; }`.

## With its own Caddy

The relay and Caddy share one pod, so only Caddy is reachable from outside; Caddy gets the
certificate from Let's Encrypt and passes requests to the relay on the pod's localhost.

```sh
mkdir -p ~/mirador-push-relay/caddy
podman pod create --name mirador-push-relay --userns=keep-id:uid=1000,gid=1000 -p <high port>:443 -p <high port + 1>:80
podman run -d --pod mirador-push-relay --name mirador-push-relay-caddy \
  -e PUSH_RELAY_DOMAIN=push.example.com \
  -v ./push-relay/deploy/Caddyfile:/etc/caddy/Caddyfile:ro,Z -v ~/mirador-push-relay/caddy:/data:Z \
  docker.io/library/caddy:2
podman run -d --init --pod mirador-push-relay --name mirador-push-relay-app \
  -v ~/mirador-push-relay/data:/data:Z -v ~/mirador-push-relay/secrets:/secrets:ro,Z \
  -e APNS_KEY_FILE=/secrets/apns.p8 -e APNS_KEY_ID=… -e APNS_TEAM_ID=… -e APNS_TOPIC=… \
  -e FCM_SERVICE_ACCOUNT_FILE=/secrets/firebase.json \
  mirador-push-relay
```

The router forwards public 443 (and 80, for the certificate's HTTP challenge) to the two high ports.

## Tokens

A token for each Mac, printed once (the container is `mirador-push-relay-app` with Caddy):

```sh
podman exec mirador-push-relay bun push-relay/main.ts token add studio-mac
```

`token list` and `token remove <label>` manage them; a removed token stops working at once.
