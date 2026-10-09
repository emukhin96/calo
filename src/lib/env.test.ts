import { afterEach, describe, expect, it, vi } from "vitest";

/** env.ts читает окружение при импорте — каждый раз модуль заново. */
async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("./env");
}

afterEach(() => vi.unstubAllEnvs());

describe("env", () => {
  it("OWNER_EMAILS: через запятую, без пробелов и регистра", async () => {
    const env = await load({ OWNER_EMAILS: " Me@Calo.test, second@calo.test ,", ALLOWED_EMAILS: "legacy@calo.test" });
    expect(env.ownerEmails).toEqual(["me@calo.test", "second@calo.test"]);
    expect(env.isOwnerEmail(" ME@calo.TEST ")).toBe(true);
    expect(env.isOwnerEmail("legacy@calo.test")).toBe(false);
    expect(env.isOwnerEmail("stranger@calo.test")).toBe(false);
  });

  it("без OWNER_EMAILS — старый ALLOWED_EMAILS; без обоих — никого", async () => {
    expect((await load({ OWNER_EMAILS: "", ALLOWED_EMAILS: "legacy@calo.test" })).isOwnerEmail("legacy@calo.test")).toBe(true);
    expect((await load({ OWNER_EMAILS: "", ALLOWED_EMAILS: "" })).ownerEmails).toEqual([]);
  });

  it("SIGNUP: закрыта только при closed, по умолчанию открыта", async () => {
    expect((await load({ SIGNUP: "closed" })).signupClosed).toBe(true);
    expect((await load({ SIGNUP: " Closed " })).signupClosed).toBe(true);
    expect((await load({ SIGNUP: "open" })).signupClosed).toBe(false);
    expect((await load({ SIGNUP: "" })).signupClosed).toBe(false);
  });
});
