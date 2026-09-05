import { describe, it, expect, vi } from "vitest";
import { normalizeDiscoverPersonNames } from "./discover-person-name-normalization";
import { isPlainDiscoverName, validateNameResult, readNameStamp } from "./discover-name-contract";
import { normalizeProfile } from "./apify-profile-search";
import { generateEmail } from "./email-generation-service";
import { planDiscoverNameRepairs } from "./discover-person-name-repair";
import { parseNameRepairArgs, repairDiscoverPersonNames } from "./discover-person-name-backfill";
import type { PrismaClient } from "@prisma/client";

const fixtures = [
  ["Rae Gruppman SHRM-CP", "Rae", "Gruppman", "SHRM-CP"],
  ["Avery Johnson, SHRM-SCP, SPHR", "Avery", "Johnson", "SHRM-SCP, SPHR"],
  ["Priya Patel, PMP, MBA", "Priya", "Patel", "PMP, MBA"],
  ["Michael Chen CPA", "Michael", "Chen", "CPA"],
  ["Dr. Jane O'Connor, PhD", "Jane", "O'Connor", "Dr. PhD"],
  ["Mary-Kate O'Neill, CFA", "Mary-Kate", "O'Neill", "CFA"],
  ["John Smith Jr., MBA", "John", "Smith", "MBA"],
  ["Alex Morgan | Growth Marketing", "Alex", "Morgan", "Growth Marketing"],
  ["Sarah Johnson (Recruiting)", "Sarah", "Johnson", "Recruiting"],
  ["Tom Lee 🚀 Hiring!", "Tom", "Lee", "Hiring"],
  ["Jan van der Meer", "Jan", "van der Meer", ""],
  ["Rae Gruppman QZX-CERT", "Rae", "Gruppman", "QZX-CERT"],
  ["王小明", "小明", "王", ""]
];
const item = (source: string, id = "0") => {
  const f = fixtures.find(f => f[0] === source)!;
  return { id, displayName: source === "王小明" ? source : `${f[1]} ${f[2]}${source.includes("Jr.") ? " Jr." : ""}`,
    givenName: f[1], familyName: f[2], middleNames: [], generationalSuffix: source.includes("Jr.") ? "Jr." : null,
    removedTokens: f[3] ? [f[3]] : [], confidence: "HIGH", canGenerateEmail: true };
};
const person = (fullName: string) => ({ firstName: fullName.split(" ")[0], lastName: fullName.split(" ").at(-1)!, fullName });
const client = () => ({ enabled: true, model: "mock", complete: vi.fn(async (req: { input: string }) => ({ items: JSON.parse(req.input).items.map((p: { sourceName: string; id: string }) => item(p.sourceName, p.id)) })) });
const format = { emailDomain: "example.org", emailDomainConfidence: "HIGH", emailPattern: "first.last", patternConfidence: "HIGH" };
const oldRow = () => ({ ...person(fixtures[0][0]), inferredEmail: "rae.shrmcp@example.org", emailStatus: "INFERRED_HIGH", emailConfidence: "HIGH", emailPattern: "first.last", emailSource: "PATTERN" });

describe("canonical Discover names", () => {
  it.each(["Rae Gruppman", "Mary-Kate O'Neill", "Jean-Luc Picard", "José García", "Anna Smith-Jones"])("fast path: %s", name => expect(isPlainDiscoverName(name)).toBe(true));
  it.each([...fixtures.map(f => f[0]), "Marketing Team", "Prince", "LI MA"])("asks rather than strips: %s", name => expect(isPlainDiscoverName(name)).toBe(false));
  it("batches the entire ambiguous page once and preserves each validated identity", async () => {
    const ai = client();
    const rows = await normalizeDiscoverPersonNames(fixtures.map(f => person(f[0])), { client: ai });
    expect(ai.complete).toHaveBeenCalledTimes(1);
    rows.forEach((r, i) => {
      expect(r.firstName).toBe(fixtures[i][1]); expect(r.lastName).toBe(fixtures[i][2]);
      expect(r.sourceName).toBe(fixtures[i][0]);
    });
    expect(generateEmail({ ...rows[0], domain: "mastercard.com", pattern: "first.last" })).toBe("rae.gruppman@mastercard.com");
    expect(generateEmail({ ...rows.at(-1)!, domain: "example.org", pattern: "first.last" })).toBeNull();
  });
  it("does not send private fields to OpenAI", async () => {
    const ai = client();
    await normalizeDiscoverPersonNames([{ ...oldRow(), userId: "private", email: "private", headline: "Public role" }], { client: ai });
    expect(ai.complete.mock.calls[0][0].input).not.toMatch(/private|inferredEmail|userId/);
  });
  it("preserves raw provider text before any parsing and batches before email generation", async () => {
    const profile = normalizeProfile({ name: fixtures[0][0], profileUrl: "https://linkedin.com/in/rae", headline: "Position" })!;
    expect(profile.sourceName).toBe(fixtures[0][0]); expect(profile.lastName).toBe("");
    const [result] = await normalizeDiscoverPersonNames([profile], { client: client() });
    expect(result.fullName).toBe("Rae Gruppman"); expect(result.currentTitle).toBe("Position"); expect(result.linkedinUrl).toBe(profile.linkedinUrl);
  });
  it.each(["timeout", "malformed"])("fails closed on %s while clean names work", async failure => {
    const ai = { ...client(), complete: vi.fn(async () => { if (failure === "timeout") throw new Error("private"); return { wrong: "json" }; }) };
    const rows = await normalizeDiscoverPersonNames([oldRow(), person("José García"), person("王小明")], { client: ai });
    expect(rows[0].firstName).toBe(""); expect(readNameStamp(rows[0])?.canGenerateEmail).toBe(false);
    expect(rows[1].lastName).toBe("García"); expect(rows[2].fullName).toBe("王小明");
    expect(generateEmail({ ...rows[0], domain: "example.org", pattern: "first" })).toBeNull();
  });
  it("rejects fabricated tokens, transliterations, credentials, company/title text and mismatched IDs", async () => {
    const good = item(fixtures[0][0]);
    expect(validateNameResult({ ...good, familyName: "Invented" }, fixtures[0][0])).toBeNull();
    expect(validateNameResult({ ...good, displayName: "Xiao Wang", givenName: "Xiao", familyName: "Wang" }, "王小明")).toBeNull();
    expect(validateNameResult({ ...good, familyName: "SHRM-CP" }, fixtures[0][0])).toBeNull();
    expect(validateNameResult({ ...good, displayName: "Rae Director", familyName: "Director" }, "Rae Director", { currentTitle: "Director" })).toBeNull();
    const ai = { ...client(), complete: vi.fn(async () => ({ items: [{ ...good, id: "unknown" }] })) };
    expect(readNameStamp((await normalizeDiscoverPersonNames([oldRow()], { client: ai }))[0])?.canGenerateEmail).toBe(false);
  });
  it("low confidence never enables any email pattern", async () => {
    const ai = { ...client(), complete: vi.fn(async () => ({ items: [{ ...item(fixtures[0][0]), confidence: "LOW" }] })) };
    const [row] = await normalizeDiscoverPersonNames([oldRow()], { client: ai });
    expect(readNameStamp(row)?.canGenerateEmail).toBe(false);
    expect(generateEmail({ ...row, domain: "example.org", pattern: "last" })).toBeNull();
  });
  it("repairs historical inferred names/emails idempotently and leaves verified/terminal sources untouched", async () => {
    const rows = [oldRow(), ...["VERIFIED", "FAILED", "SUPPRESSED", "UNSUBSCRIBED"].map(emailStatus => ({ ...oldRow(), emailStatus })), { ...oldRow(), emailSource: "PUBLIC" }];
    const ai = client();
    const first = await planDiscoverNameRepairs(rows, () => format, { client: ai });
    expect(first.plans[0].fields.inferredEmail).toBe("rae.gruppman@example.org");
    first.plans.slice(1).forEach(p => expect(p.fields.inferredEmail).toBe(rows[0].inferredEmail));
    const second = await planDiscoverNameRepairs(first.plans.map(p => p.fields), () => format, { client: ai });
    expect(second.stats.changed).toBe(0); expect(ai.complete).toHaveBeenCalledTimes(1);
  });
  it("clears a wrong guess when normalization is unavailable", async () => {
    const result = await planDiscoverNameRepairs([oldRow()], () => format, { client: { ...client(), enabled: false } });
    expect(result.plans[0].fields.inferredEmail).toBeNull(); expect(result.plans[0].fields.emailStatus).toBe("UNAVAILABLE");
  });
  it("dry-run and apply use identical bounded plans for both stores", async () => {
    let rows = [ { ...oldRow(), id: "row", updatedAt: new Date(), cache: { ...format, companyName: "Example" } } ];
    const updateMany = vi.fn(async ({ data }) => { rows = rows.map(p => ({ ...p, ...data })); return { count: 1 }; });
    const db = { prospectPerson: { findMany: vi.fn(async () => []) }, discoverSearchCachePerson: {
      findMany: vi.fn(async ({ where }) => where.id ? [] : rows), updateMany } } as unknown as PrismaClient;
    const ai = client();
    const options = parseNameRepairArgs(["--limit", "1", "--batch-size", "1"]);
    expect((await repairDiscoverPersonNames(db, options, { client: ai })).changed).toBe(1); expect(updateMany).not.toHaveBeenCalled();
    await repairDiscoverPersonNames(db, { ...options, apply: true }, { client: ai }); expect(updateMany).toHaveBeenCalledTimes(1);
    expect((await repairDiscoverPersonNames(db, options, { client: ai })).changed).toBe(0);
  });
});

it("repairs user-owned rows without reviving suppression and rejects concurrent updates", async () => {
  let row = { ...oldRow(), id: "person", userId: "owner", company: { ...format, name: "Example", officialName: null }, updatedAt: new Date() };
  const updateMany = vi.fn(async ({ data }) => { row = { ...row, ...data }; return { count: 1 }; });
  const db = { prospectPerson: { findMany: vi.fn(async ({ where }) => where.id ? [] : [row]), updateMany },
    discoverSearchCachePerson: { findMany: vi.fn(async () => []) },
    suppression: { findMany: vi.fn(async () => [{ email: row.inferredEmail, reason: "HARD_BOUNCE" }]) } } as unknown as PrismaClient;
  const opts = { apply: true, batchSize: 50, limit: 1 };
  const first = await repairDiscoverPersonNames(db, opts, { client: client() });
  expect(first.changed).toBe(1); expect(first.emailsRegenerated).toBe(0);
  expect(row).toMatchObject({ fullName: "Rae Gruppman", inferredEmail: "rae.shrmcp@example.org", emailStatus: "INVALID" });
  expect((await repairDiscoverPersonNames(db, opts, { client: client() })).changed).toBe(0);
  expect(updateMany).toHaveBeenCalledTimes(1);
  expect(updateMany.mock.calls[0][0]).toHaveProperty("where.updatedAt");
});

it("bounds large AI pages and refuses duplicate ids", async () => {
  const ai = client();
  await normalizeDiscoverPersonNames(Array.from({ length: 51 }, () => oldRow()), { client: ai });
  expect(ai.complete).toHaveBeenCalledTimes(2);
  expect(JSON.parse(ai.complete.mock.calls[0][0].input).items).toHaveLength(50);
  const bad = { ...client(), complete: vi.fn(async () => ({ items: [item(fixtures[0][0]), item(fixtures[0][0])] })) };
  const rows = await normalizeDiscoverPersonNames([oldRow(), oldRow()], { client: bad });
  expect(rows.every(r => !readNameStamp(r)?.canGenerateEmail)).toBe(true);
});

it("does not destroy uppercase short surnames, mononyms, or allow a stale stamp", async () => {
  const ai = { ...client(), complete: vi.fn(async () => ({ items: [
    { ...item(fixtures[0][0]), id: "0", displayName: "LI MA", givenName: "LI", familyName: "MA", removedTokens: [] },
    { ...item(fixtures[0][0]), id: "1", displayName: "Prince", givenName: null, familyName: null, removedTokens: [], confidence: "LOW", canGenerateEmail: false }
  ] })) };
  const rows = await normalizeDiscoverPersonNames([person("LI MA"), person("Prince")], { client: ai });
  expect(rows[0].lastName).toBe("MA"); expect(rows[1].fullName).toBe("Prince");
  expect(generateEmail({ ...rows[1], domain: "example.org", pattern: "first" })).toBeNull();
  expect(readNameStamp({ ...rows[0], lastName: "Other" })).toBeNull();
});
