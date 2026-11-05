import { describe, expect, it } from "vitest";
import { requireSuperAdmin, requireSportAccess } from "../src/auth/authorize";
import type { AuthContext } from "../src/auth/authorize";
import type { AdminDoc } from "../../shared/types";

function ctx(admin: Partial<AdminDoc>): AuthContext {
  return {
    email: admin.email ?? "user@example.com",
    admin: {
      email: admin.email ?? "user@example.com",
      role: admin.role ?? "SPORT_COORDINATOR",
      sportIds: admin.sportIds ?? [],
      active: admin.active ?? true,
      createdAt: "",
      createdBy: "",
      updatedAt: "",
      updatedBy: "",
    },
    db: {} as AuthContext["db"],
  };
}

describe("requireSuperAdmin", () => {
  it("allows a SUPER_ADMIN", () => {
    expect(() => requireSuperAdmin(ctx({ role: "SUPER_ADMIN" }))).not.toThrow();
  });

  it("rejects a SPORT_COORDINATOR", () => {
    expect(() => requireSuperAdmin(ctx({ role: "SPORT_COORDINATOR" }))).toThrowError(
      expect.objectContaining({ code: "SUPER_ADMIN_REQUIRED" })
    );
  });
});

describe("requireSportAccess", () => {
  it("always allows a SUPER_ADMIN, regardless of sportIds", () => {
    expect(() => requireSportAccess(ctx({ role: "SUPER_ADMIN", sportIds: [] }), "basketball")).not.toThrow();
  });

  it("allows a coordinator assigned to that sport", () => {
    expect(() =>
      requireSportAccess(ctx({ role: "SPORT_COORDINATOR", sportIds: ["basketball", "chess"] }), "basketball")
    ).not.toThrow();
  });

  it("rejects a coordinator not assigned to that sport", () => {
    expect(() =>
      requireSportAccess(ctx({ role: "SPORT_COORDINATOR", sportIds: ["chess"] }), "basketball")
    ).toThrowError(expect.objectContaining({ code: "SPORT_NOT_ASSIGNED" }));
  });

  it("rejects a coordinator with no sportIds at all", () => {
    expect(() =>
      requireSportAccess(ctx({ role: "SPORT_COORDINATOR", sportIds: [] }), "basketball")
    ).toThrowError(expect.objectContaining({ code: "SPORT_NOT_ASSIGNED" }));
  });
});
