export function calculateTokenExpiry(
  requestTimeMs: number,
  expiresInSeconds: unknown,
  accessToken?: string,
): number {
  if (typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds) && expiresInSeconds > 0) {
    return requestTimeMs + expiresInSeconds * 1000;
  }

  const jwtExpiry = getJwtExpiry(accessToken);
  if (jwtExpiry) {
    return jwtExpiry;
  }

  return requestTimeMs + 3600 * 1000;
}

export function getJwtExpiry(token?: string): number | undefined {
  if (!token || !token.includes(".")) {
    return undefined;
  }

  try {
    const parts = token.split(".");
    const payload = parts[1];
    if (!payload) {
      return undefined;
    }

    const json = Buffer.from(payload, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const exp = parsed.exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) {
      return undefined;
    }
    return exp * 1000;
  } catch {
    return undefined;
  }
}
