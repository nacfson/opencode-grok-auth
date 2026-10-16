# Grok OAuth Auth Plugin for OpenCode

OpenCode V2 plugin that adds a **browser sign-in for SuperGrok / X Premium** on
top of the built-in `xai` integration. It registers an OAuth method
(`SuperGrok Subscription (browser)`) that runs the xAI authorization-code +
PKCE flow against `auth.x.ai`, captures the callback on a local loopback
listener (`http://127.0.0.1:56121/callback`), and refreshes tokens
automatically through the discovered xAI token endpoint.

Use it when you prefer the browser loopback flow over OpenCode's built-in
device-code method (`SuperGrok Subscription`), which prints a code for
`auth.x.ai/device` instead of opening a browser.

## Requirements

- OpenCode V2 (`opencode --version` reports `2.x`)
- Node 20+ for development; the plugin itself runs inside OpenCode

## Install

Once published, add the package:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-grok-auth"]
}
```

Local checkout (this repository):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-grok-auth"]
}
```

Build it first so the package entry resolves:

```sh
bun install
bun run build
```

## Usage

1. Run `/connect` in OpenCode.
2. Select **xAI**.
3. Pick **SuperGrok Subscription (browser)**.
4. Complete the sign-in in the browser (or open the printed URL manually).
5. Pick a Grok model with `/models`.

On a remote host, forward the callback port before opening the URL:

```sh
ssh -L 56121:127.0.0.1:56121 user@host
```

Set `OPENCODE_XAI_OAUTH_NO_BROWSER=1` to always print the URL instead of
launching a browser. In SSH sessions, remote containers, and headless Linux
sessions the browser is never launched automatically.

## How it works

The core of OpenCode V2 ships a device-code OAuth method for the `xai`
integration. This plugin adds a second OAuth method through
`ctx.integration.transform`:

- xAI OIDC discovery from `https://auth.x.ai/.well-known/openid-configuration`
  with endpoint pinning to HTTPS `x.ai` / `*.x.ai` origins.
- Authorization-code + PKCE (S256) with `state` and `nonce` validation.
- Loopback callback listener on `127.0.0.1:56121` with random-port fallback.
- Refresh handling stored with the credential, using the discovered token
  endpoint recorded in the credential metadata.
- Public desktop OAuth client ID used by the Grok CLI (`grok-cli:access`
  scope); no API key required.

## Development

```sh
bun install
bun run typecheck
bun run test
bun run build
```

## Security notes

- Never commit credentials, auth stores, or `.env` files.
- The xAI OAuth client ID is public desktop OAuth metadata, not a secret.
- Discovered OAuth endpoints are pinned to HTTPS xAI origins.
- Tokens are stored by OpenCode's credential store, not by this plugin.

## Credits

Implementation pattern inspired by the OpenCode `xai` provider plugin and
`opencode-cursor` (both V2). Originally written against the V1 plugin API by
ysnock404; ported to the V2 integration API in this repository.

## License

MIT
