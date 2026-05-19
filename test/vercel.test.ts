import { describe, expect, it, vi } from "vitest";
import { handleVercelRequest } from "../src/vercel";

describe("handleVercelRequest", () => {
  it("serves health checks", async () => {
    const response = await handleVercelRequest(new Request("https://cache.test/ghc/healthz"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, runtime: "vercel" });
  });

  it("rewrites repo JSON avatars to the same-origin /ghc route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          full_name: "saicaca/fuwari",
          owner: {
            login: "saicaca",
            avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-RateLimit-Remaining": "42",
          },
        },
      ),
    );

    const response = await handleVercelRequest(new Request("https://cache.test/ghc/repos/saicaca/fuwari"));
    const body = await response.json() as { owner: { avatar_url: string } };

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Cache")).toBe("MISS");
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=21600");
    expect(body.owner.avatar_url).toBe("https://cache.test/ghc/avatar/saicaca?size=96");
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(new URL("https://api.github.com/repos/saicaca/fuwari"));

    fetchMock.mockRestore();
  });
});
