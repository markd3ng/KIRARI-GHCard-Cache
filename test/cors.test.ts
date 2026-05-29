import { describe, expect, it } from "vitest";
import { evaluateCors } from "../src/cors";

describe("evaluateCors", () => {
  it("rejects browser origins when no allowlist is configured", () => {
    const request = new Request("https://cache.test/api/github/repos/a/b", {
      headers: { Origin: "https://evil.example.com" },
    });

    expect(evaluateCors(request, { ALLOWED_ORIGINS: "" })).toEqual({ allowed: false });
  });

  it("allows no-Origin requests when no allowlist is configured", () => {
    const request = new Request("https://cache.test/api/github/repos/a/b");

    expect(evaluateCors(request, { ALLOWED_ORIGINS: "" })).toEqual({ allowed: true });
  });

  it("allows matching configured origins", () => {
    const request = new Request("https://cache.test/api/github/repos/a/b", {
      headers: { Origin: "https://kirari.example.com" },
    });

    expect(evaluateCors(request, { ALLOWED_ORIGINS: "https://kirari.example.com" })).toEqual({
      allowed: true,
      allowOrigin: "https://kirari.example.com",
    });
  });

  it("rejects non-matching configured origins", () => {
    const request = new Request("https://cache.test/api/github/repos/a/b", {
      headers: { Origin: "https://other.example.com" },
    });

    expect(evaluateCors(request, { ALLOWED_ORIGINS: "https://kirari.example.com" })).toEqual({ allowed: false });
  });
});
