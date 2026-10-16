import { describe, expect, it } from "vitest";
import { calculateTokenExpiry, getJwtExpiry } from "../src/auth.js";

function fakeJwt(expSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds }), "utf8").toString("base64url");
  return `header.${payload}.signature`;
}

describe("xAI auth helpers", () => {
  it("calculates absolute expiry from expires_in", () => {
    expect(calculateTokenExpiry(1000, 60)).toBe(61_000);
  });

  it("ignores malformed expires_in and falls back to the JWT exp claim", () => {
    expect(calculateTokenExpiry(1000, "60", fakeJwt(120))).toBe(120_000);
    expect(calculateTokenExpiry(1000, -5, fakeJwt(120))).toBe(120_000);
  });

  it("falls back to one hour when nothing is available", () => {
    expect(calculateTokenExpiry(1000, undefined)).toBe(1000 + 3600 * 1000);
  });

  it("extracts the exp claim from a JWT access token", () => {
    expect(getJwtExpiry(fakeJwt(42))).toBe(42_000);
    expect(getJwtExpiry("not-a-jwt")).toBeUndefined();
  });
});
