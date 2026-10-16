import { spawn } from "node:child_process";
import { Integration, Plugin } from "@opencode/plugin";
import {
  INTEGRATION_ID,
  OAUTH_CALLBACK_TIMEOUT_MS,
  OAUTH_METHOD_ID,
  OAUTH_METHOD_LABEL,
} from "./constants.js";
import {
  buildXaiAuthorizeUrl,
  createOAuthNonce,
  createOAuthState,
  discoverXaiOAuth,
  exchangeXaiCodeForTokens,
  generatePkce,
  parseOAuthCallbackInput,
  refreshXaiTokens,
  validateXaiOAuthEndpoint,
} from "./oauth.js";
import { startXaiOAuthListener, type OAuthListener } from "./server.js";

/**
 * Shape of an OAuth credential as stored by the OpenCode V2 credential store.
 * Mirrors `Credential.OAuth` from `@opencode/plugin` without importing the
 * branded schema types, so the registration stays structurally compatible.
 */
interface StoredOAuthCredential {
  type: "oauth";
  methodID: string;
  access: string;
  refresh: string;
  expires: number;
  metadata?: Record<string, unknown>;
}

export interface XaiOAuthDependencies {
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests. Defaults to the loopback listener in server.ts. */
  createListener?: () => Promise<OAuthListener>;
  /** Injectable for tests. Defaults to opening the system browser. */
  openBrowser?: (url: string) => Promise<boolean>;
}

/**
 * Builds the OpenCode V2 integration OAuth method registration that adds a
 * browser (loopback PKCE) sign-in for the built-in `xai` integration. The
 * built-in plugin ships a device-code method; this adds the browser flow
 * back on V2 and refreshes tokens through the discovered xAI token endpoint.
 */
export function createXaiOAuthMethodRegistration(deps: XaiOAuthDependencies = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const createListener = deps.createListener ?? (() => startXaiOAuthListener());
  const launchBrowser = deps.openBrowser ?? openBrowser;

  return {
    integrationID: INTEGRATION_ID,
    method: {
      id: OAUTH_METHOD_ID,
      type: "oauth" as const,
      label: OAUTH_METHOD_LABEL,
    },
    authorize: async () => {
      const discovery = await discoverXaiOAuth(fetchImpl);
      const listener = await createListener();
      const pkce = generatePkce();
      const state = createOAuthState();
      const nonce = createOAuthNonce();
      const authorizationUrl = buildXaiAuthorizeUrl({
        authorizationEndpoint: discovery.authorizationEndpoint,
        redirectUri: listener.redirectUri,
        codeChallenge: pkce.challenge,
        state,
        nonce,
      });

      const browserOpened = shouldOpenBrowser() ? await launchBrowser(authorizationUrl) : false;
      const instructions = [
        browserOpened
          ? "Complete the SuperGrok sign-in in your browser. OpenCode captures the xAI callback locally."
          : "Open the OAuth URL and complete the xAI sign-in.",
        "",
        authorizationUrl,
        "",
        `Callback listener: ${listener.redirectUri}`,
        "If this is a remote shell, forward the callback port to this machine first.",
      ].join("\n");

      return {
        mode: "auto" as const,
        url: authorizationUrl,
        instructions,
        expiresAt: Date.now() + OAUTH_CALLBACK_TIMEOUT_MS,
        callback: (async () => {
          try {
            const callbackUrl = await listener.waitForCallback(OAUTH_CALLBACK_TIMEOUT_MS);
            const parsed = parseOAuthCallbackInput(callbackUrl.toString(), state);
            if ("error" in parsed) {
              throw new Error(parsed.error);
            }

            const tokens = await exchangeXaiCodeForTokens({
              tokenEndpoint: discovery.tokenEndpoint,
              code: parsed.code,
              redirectUri: listener.redirectUri,
              codeVerifier: pkce.verifier,
              codeChallenge: pkce.challenge,
              fetchImpl,
            });

            return {
              type: "oauth" as const,
              methodID: Integration.MethodID.make(OAUTH_METHOD_ID),
              access: tokens.accessToken,
              refresh: tokens.refreshToken,
              expires: tokens.expiresAt,
              metadata: { tokenEndpoint: discovery.tokenEndpoint },
            };
          } finally {
            await listener.close().catch(() => undefined);
          }
        })(),
      };
    },
    refresh: async (credential: StoredOAuthCredential) => {
      const tokenEndpoint = await resolveTokenEndpoint(credential.metadata, fetchImpl);
      const refreshed = await refreshXaiTokens({
        tokenEndpoint,
        refreshToken: credential.refresh,
        fetchImpl,
      });

      return {
        type: "oauth" as const,
        methodID: Integration.MethodID.make(OAUTH_METHOD_ID),
        access: refreshed.accessToken,
        refresh: refreshed.refreshToken || credential.refresh,
        expires: refreshed.expiresAt,
        metadata: credential.metadata,
      };
    },
  };
}

async function resolveTokenEndpoint(
  metadata: Record<string, unknown> | undefined,
  fetchImpl: typeof fetch,
): Promise<string> {
  const stored = metadata?.tokenEndpoint;
  if (typeof stored === "string" && stored.trim()) {
    return validateXaiOAuthEndpoint(stored.trim(), "token_endpoint");
  }
  return (await discoverXaiOAuth(fetchImpl)).tokenEndpoint;
}

export const XaiGrokOAuthPlugin = Plugin.define({
  id: "opencode-grok-auth",
  async setup(ctx) {
    await ctx.integration.transform((editor) => {
      editor.method.update(createXaiOAuthMethodRegistration());
    });
  },
});

export default XaiGrokOAuthPlugin;

function shouldOpenBrowser(): boolean {
  if (process.env.OPENCODE_XAI_OAUTH_NO_BROWSER === "1") {
    return false;
  }
  if (process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION) {
    return false;
  }
  if (process.env.REMOTE_CONTAINERS || process.env.CODESPACES) {
    return false;
  }
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return false;
  }
  return true;
}

function openBrowser(url: string): Promise<boolean> {
  const command = browserCommand(url);
  if (!command) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

function browserCommand(url: string): { file: string; args: string[] } | undefined {
  if (process.platform === "darwin") {
    return { file: "open", args: [url] };
  }
  if (process.platform === "win32") {
    return { file: "explorer.exe", args: [url] };
  }
  return { file: "xdg-open", args: [url] };
}
