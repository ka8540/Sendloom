import { describe, expect, it } from "vitest";

import {
  emptyRepairStats,
  planPersonIdentityRepair,
  recordRepairPlan,
  type RepairableEmailFormat,
  type RepairablePerson
} from "@/services/prospects/discover-identity-repair";

const APPLE: RepairableEmailFormat = {
  emailDomain: "apple.com",
  emailDomainConfidence: "HIGH",
  emailPattern: "first.last",
  patternConfidence: "HIGH"
};

const NO_FORMAT: RepairableEmailFormat = {
  emailDomain: null,
  emailDomainConfidence: "UNAVAILABLE",
  emailPattern: null,
  patternConfidence: "UNAVAILABLE"
};

function person(overrides: Partial<RepairablePerson> = {}): RepairablePerson {
  return {
    firstName: "Jared",
    lastName: "Cho",
    fullName: "Jared Cho",
    inferredEmail: "jared.cho@apple.com",
    emailStatus: "INFERRED_HIGH",
    emailConfidence: "HIGH",
    emailPattern: "first.last",
    emailSource: "PATTERN",
    ...overrides
  };
}

const plan = (row: RepairablePerson, format: RepairableEmailFormat = APPLE) =>
  planPersonIdentityRepair(row, format, { allowLowConfidence: false });

describe("planPersonIdentityRepair — healthy rows", () => {
  it("leaves an already-correct row completely untouched", () => {
    const result = plan(person());
    expect(result.changed).toBe(false);
    expect(result.nameChanged).toBe(false);
    expect(result.emailAction).toBe("NONE");
    expect(result.fields).toEqual({
      firstName: "Jared",
      lastName: "Cho",
      fullName: "Jared Cho",
      inferredEmail: "jared.cho@apple.com",
      emailStatus: "INFERRED_HIGH",
      emailConfidence: "HIGH",
      emailPattern: "first.last",
      emailSource: "PATTERN"
    });
  });

  it("does not touch a real surname that resembles a degree abbreviation", () => {
    const result = plan(
      person({ firstName: "Li", lastName: "Ma", fullName: "Li Ma", inferredEmail: "li.ma@apple.com" })
    );
    expect(result.changed).toBe(false);
  });

  it("never rewrites an address Sendloom did not generate", () => {
    const verified = person({
      firstName: "Jared",
      lastName: "Cho M.B.A.",
      fullName: "Jared Cho M.B.A.",
      inferredEmail: "jared@apple.com",
      emailStatus: "VERIFIED",
      emailSource: "HUNTER"
    });
    const result = plan(verified);
    expect(result.nameChanged).toBe(true);
    expect(result.fields.lastName).toBe("Cho");
    // The name is repaired, the externally sourced address is preserved.
    expect(result.fields.inferredEmail).toBe("jared@apple.com");
    expect(result.fields.emailStatus).toBe("VERIFIED");
    expect(result.emailAction).toBe("NONE");
  });
});

describe("planPersonIdentityRepair — malformed names", () => {
  it("repairs a credential-polluted surname and regenerates the address", () => {
    const result = plan(
      person({
        lastName: "Cho M.B.A.",
        fullName: "Jared Cho M.B.A.",
        inferredEmail: "jared.chomba@apple.com"
      })
    );
    expect(result.changed).toBe(true);
    expect(result.nameChanged).toBe(true);
    expect(result.fields.lastName).toBe("Cho");
    expect(result.fields.fullName).toBe("Jared Cho");
    expect(result.emailAction).toBe("REGENERATED");
    expect(result.fields.inferredEmail).toBe("jared.cho@apple.com");
  });

  it("repairs a middle initial fused into the surname", () => {
    const result = plan(
      person({ lastName: "M. Cho", fullName: "Jared M. Cho", inferredEmail: "jared.mcho@apple.com" })
    );
    expect(result.fields.lastName).toBe("Cho");
    expect(result.fields.inferredEmail).toBe("jared.cho@apple.com");
  });

  it("repairs a parenthetical alias fused into the surname", () => {
    const result = plan(
      person({
        lastName: "(Yiming) Cho",
        fullName: "Jared (Yiming) Cho",
        inferredEmail: "jared.yimingcho@apple.com"
      })
    );
    expect(result.fields.lastName).toBe("Cho");
    expect(result.fields.inferredEmail).toBe("jared.cho@apple.com");
  });

  it("strips decorations out of a stored display name", () => {
    const result = plan(person({ firstName: "🚀 Jared", fullName: "🚀 Jared Cho" }));
    expect(result.fields.firstName).toBe("Jared");
    expect(result.fields.fullName).toBe("Jared Cho");
  });
});

describe("planPersonIdentityRepair — unresolvable identities", () => {
  it("clears the address of an initial-only surname", () => {
    const result = plan(
      person({ lastName: "C.", fullName: "Jared C.", inferredEmail: "jared.c@apple.com" })
    );
    expect(result.changed).toBe(true);
    expect(result.emailAction).toBe("CLEARED");
    expect(result.fields.lastName).toBe("");
    expect(result.fields.fullName).toBe("Jared C.");
    expect(result.fields.inferredEmail).toBeNull();
    expect(result.fields.emailStatus).toBe("UNAVAILABLE");
    expect(result.fields.emailPattern).toBeNull();
    expect(result.fields.emailSource).toBeNull();
    expect(result.identityStatus).toBe("AMBIGUOUS");
  });

  it("clears a stale address even when no replacement can be generated", () => {
    const result = plan(
      person({ lastName: "Cho M.B.A.", fullName: "Jared Cho M.B.A.", inferredEmail: "jared.chomba@apple.com" }),
      NO_FORMAT
    );
    expect(result.emailAction).toBe("CLEARED");
    expect(result.fields.inferredEmail).toBeNull();
    expect(result.fields.emailStatus).toBe("UNAVAILABLE");
    // The name is still repaired even though no address can replace the old one.
    expect(result.fields.lastName).toBe("Cho");
  });

  it("marks a person with no surname at all as unavailable", () => {
    const result = plan(person({ lastName: "", fullName: "Jared", inferredEmail: "jared.cho@apple.com" }));
    expect(result.identityStatus).toBe("INCOMPLETE");
    expect(result.emailAction).toBe("CLEARED");
    expect(result.fields.inferredEmail).toBeNull();
  });
});

describe("planPersonIdentityRepair — idempotency", () => {
  it.each([
    ["credential surname", person({ lastName: "Cho M.B.A.", fullName: "Jared Cho M.B.A.", inferredEmail: "jared.chomba@apple.com" }), APPLE],
    ["initial surname", person({ lastName: "C.", fullName: "Jared C.", inferredEmail: "jared.c@apple.com" }), APPLE],
    ["emoji name", person({ firstName: "🚀 Jared", fullName: "🚀 Jared Cho" }), APPLE],
    ["no company format", person({ lastName: "Cho MBA", fullName: "Jared Cho MBA" }), NO_FORMAT]
  ])("reports no further change on a second pass over a repaired %s", (_label, row, format) => {
    const first = planPersonIdentityRepair(row, format, { allowLowConfidence: false });
    expect(first.changed).toBe(true);

    const repaired: RepairablePerson = { ...row, ...first.fields };
    const second = planPersonIdentityRepair(repaired, format, { allowLowConfidence: false });

    expect(second.changed).toBe(false);
    expect(second.emailAction).toBe("NONE");
    expect(second.fields).toEqual(first.fields);
  });
});

describe("repair statistics", () => {
  it("counts each outcome without recording any personal data", () => {
    const stats = emptyRepairStats();

    recordRepairPlan(stats, plan(person()));
    recordRepairPlan(
      stats,
      plan(person({ lastName: "Cho M.B.A.", fullName: "Jared Cho M.B.A.", inferredEmail: "jared.chomba@apple.com" }))
    );
    recordRepairPlan(stats, plan(person({ lastName: "C.", fullName: "Jared C.", inferredEmail: "jared.c@apple.com" })));

    expect(stats.rowsScanned).toBe(3);
    expect(stats.unchanged).toBe(1);
    expect(stats.deterministicNamesFixed).toBe(2);
    expect(stats.ambiguousNamesFound).toBe(1);
    expect(stats.inferredEmailsRecomputed).toBe(1);
    expect(stats.malformedEmailsCleared).toBe(1);
    expect(stats.failures).toBe(0);

    // Every stat is a plain number — no name or address can leak through logs.
    for (const value of Object.values(stats)) {
      expect(typeof value).toBe("number");
    }
  });
});
