import { describe, expect, it } from "vitest";

import type { ResolvedCachePerson } from "@/services/prospects/discover-cache-service";
import { filterReusableDiscoverPeople } from "@/services/prospects/discover-cache-reuse";

function person(overrides: Partial<ResolvedCachePerson> = {}): ResolvedCachePerson {
  return {
    sourceProfileId: "p1",
    firstName: "Jane",
    lastName: "Doe",
    fullName: "Jane Doe",
    currentTitle: "Recruiter",
    normalizedTitle: "recruiter",
    positionCategory: "RECRUITING",
    location: "San Francisco, California, United States",
    country: "United States",
    state: "California",
    city: "San Francisco",
    linkedinUrl: "https://www.linkedin.com/in/p1",
    inferredEmail: null,
    emailStatus: "UNAVAILABLE",
    emailConfidence: "UNAVAILABLE",
    emailPattern: null,
    emailSource: null,
    ...overrides
  };
}

describe("filterReusableDiscoverPeople", () => {
  it("uses the existing role category and exact normalized location components", () => {
    const people = [
      person(),
      person({ sourceProfileId: "p2", currentTitle: "Software Engineer", normalizedTitle: "software engineer", positionCategory: "SOFTWARE_ENGINEERING" }),
      person({ sourceProfileId: "p3", country: "Canada", state: "Ontario", city: "Toronto", location: "Toronto, Canada" })
    ];

    const matches = filterReusableDiscoverPeople({
      people,
      requestedRoles: [{ normalizedTitle: "technical recruiter", category: "RECRUITING" }],
      requestedLocations: ["United States"]
    });

    expect(matches.map((entry) => entry.sourceProfileId)).toEqual(["p1"]);
  });

  it("never treats OTHER as a broad shared category", () => {
    const matches = filterReusableDiscoverPeople({
      people: [
        person({ currentTitle: "Quantum Mechanic", normalizedTitle: "quantum mechanic", positionCategory: "OTHER" }),
        person({ sourceProfileId: "p2", currentTitle: "Chief Wizard", normalizedTitle: "chief wizard", positionCategory: "OTHER" })
      ],
      requestedRoles: [{ normalizedTitle: "quantum mechanic", category: "OTHER" }],
      requestedLocations: []
    });

    expect(matches.map((entry) => entry.sourceProfileId)).toEqual(["p1"]);
  });

  it("does not invent geographic containment", () => {
    const matches = filterReusableDiscoverPeople({
      people: [person()],
      requestedRoles: [{ normalizedTitle: "recruiter", category: "RECRUITING" }],
      requestedLocations: ["North America"]
    });

    expect(matches).toEqual([]);
  });
});
