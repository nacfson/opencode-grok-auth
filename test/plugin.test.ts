import { describe, expect, it, vi } from "vitest";
import { Integration } from "@opencode/plugin";
import { XaiGrokOAuthPlugin, createXaiOAuthMethodRegistration } from "../src/plugin.js";
import type { OAuthListener } from "../src/server.js";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("plugin definition", () => {
  it("exposes a V2 plugin that registers the browser OAuth method on xai", async () => {
    expect(XaiGrokOAuthPlugin.id).toBe("opencode-grok-auth");

    let captured: { integrationID: string; method: { id: string } } | undefined;
    const ctx = {
      integration: {
        transform: async (callback: (editor: unknown) => void) => {
          callback({
            method: {
              update: (input: typeof captured) => {
                captured = input;
              },
            },
          });
        },
      },
    } as unknown as Parameters<typeof XaiGrokOAuthPlugin.setup>[0];

    await XaiGrokOAuthPlugin.setup(ctx);
    expect(captured?.integrationID).toBe("xai");
    expect(captured?.method.id).toBe("browser-pkce");
  });
});

describe("createXaiOAuthMethodRegistration", () => {
  it("targets the xai integration with a browser OAuth method", () => {
    const registration = createXaiOAuthMethodRegistration();
    expect(registration.integrationID).toBe("xai");
    expect(registration.method).toEqual({
      id: "browser-pkce",
      type: "oauth",
      label: "SuperGrok Subscription (browser)",
    });
  });

  it("runs the loopback PKCE flow and returns an OAuth credential", async () => {
    let resolveCallback: ((url: URL) => void) | undefined;
    const listener: OAuthListener = {
      redirectUri: "http://127.0.0.1:56121/callback",
      waitForCallback: () =>
        new Promise<URL>((resolve) => {
          resolveCallback = resolve;
        }),
      close: async () => undefined,
    };

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes(".well-known")) {
        return jsonResponse({
          authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
          token_endpoint: "https://auth.x.ai/oauth2/token",
        });
      }
      const body = String(init?.body ?? "");
      if (url.endsWith("/oauth2/token") && body.includes("grant_type=authorization_code")) {
        return jsonResponse({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const registration = createXaiOAuthMethodRegistration({
      fetchImpl,
      createListener: async () => listener,
      openBrowser: async () => false,
    });

    const authorization = await registration.authorize();
    expect(authorization.mode).toBe("auto");
    expect(authorization.instructions).toContain("auth.x.ai");

    const state = new URL(authorization.url).searchParams.get("state");
    expect(state).toBeTruthy();

    resolveCallback?.(new URL(`${listener.redirectUri}?code=code-1&state=${state}`));
    const credential = await authorization.callback;

    expect(credential.type).toBe("oauth");
    expect(credential.access).toBe("access-1");
    expect(credential.refresh).toBe("refresh-1");
    expect(credential.expires).toBeGreaterThan(Date.now());
    expect(credential.metadata?.tokenEndpoint).toBe("https://auth.x.ai/oauth2/token");
  });

  it("rejects a callback whose state does not match", async () => {
    let resolveCallback: ((url: URL) => void) | undefined;
    const listener: OAuthListener = {
      redirectUri: "http://127.0.0.1:56121/callback",
      waitForCallback: () =>
        new Promise<URL>((resolve) => {
          resolveCallback = resolve;
        }),
      close: async () => undefined,
    };

    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
        token_endpoint: "https://auth.x.ai/oauth2/token",
      }),
    ) as unknown as typeof fetch;

    const registration = createXaiOAuthMethodRegistration({
      fetchImpl,
      createListener: async () => listener,
      openBrowser: async () => false,
    });

    const authorization = await registration.authorize();
    resolveCallback?.(new URL(`${listener.redirectUri}?code=code-1&state=wrong`));
    await expect(authorization.callback).rejects.toThrow(/state mismatch/);
  });

  it("refreshes tokens through the stored token endpoint", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const body = String(init?.body ?? "");
      if (url === "https://auth.x.ai/oauth2/token" && body.includes("grant_type=refresh_token")) {
        return jsonResponse({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 60,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const registration = createXaiOAuthMethodRegistration({ fetchImpl });
    const credential = {
      type: "oauth" as const,
      methodID: Integration.MethodID.make("browser-pkce"),
      access: "access-1",
      refresh: "refresh-1",
      expires: 1,
      metadata: { tokenEndpoint: "https://auth.x.ai/oauth2/token" },
    };

    const refreshed = await registration.refresh(credential);
    expect(refreshed.type).toBe("oauth");
    expect(refreshed.access).toBe("access-2");
    expect(refreshed.refresh).toBe("refresh-2");
    expect(refreshed.expires).toBeGreaterThan(Date.now());
    expect(refreshed.metadata?.tokenEndpoint).toBe("https://auth.x.ai/oauth2/token");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
