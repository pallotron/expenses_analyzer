/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

import { forgetPassword, loadPassword, savePassword } from "../../payslips/passwords";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("payslip passwords", () => {
  it("remembers a password per person, and forgets it", () => {
    savePassword(1, "one");
    savePassword(2, "two");
    expect([loadPassword(1), loadPassword(2)]).toEqual(["one", "two"]);
    forgetPassword(1);
    expect(loadPassword(1)).toBe("");
  });

  it("works without storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => savePassword(1, "x")).not.toThrow();
    expect(loadPassword(1)).toBe("");
  });
});
