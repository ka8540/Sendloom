import { describe, expect, it } from 'vitest';
import { isPlausibleCompanyName, validateCurrentEmployment } from './current-employment-evidence';
import { parseLinkedInSearchResult } from './linkedin-search-result-parser';
import type { WebSearchResult } from './web-search-provider';

function classify(headline: string, company: string, description: string | null = null) {
  const row: WebSearchResult = {
    title: headline === 'John Smith | LinkedIn' ? headline : `Jane Person - ${headline} | LinkedIn`,
    url: 'https://linkedin.com/in/jane-person',
    snippet: description
  };
  const profile = parseLinkedInSearchResult(row);
  expect(profile).not.toBeNull();
  return validateCurrentEmployment(row, profile!, company, ['Software Engineer']);
}

describe('conservative current-employment evidence', () => {
  it.each([
    ['Senior Software Engineer @ Ramp', 'Ramp', 'Previously worked at Achilles'],
    ['Software Engineer at Citigroup', 'Citigroup', 'Former software engineer at JPMorgan'],
    ['Backend Software Engineer | Datadog', 'Datadog', null],
    ['Software Developer - IMC Trading', 'IMC Trading', null],
    ['Software Engineer', 'Ramp', 'Building developer infrastructure at Ramp'],
    ['Senior FE Software Engineer @ Ramp', 'Ramp', 'Building reliable systems for customers'],
    ['Software Engineer at Ramp', 'Ramp', 'Present 6 months'],
    ['Software Engineer at Ramp', 'Ramp', 'Waterloo Alumni'],
    ['Software Engineer at Ramp', 'Ramp', 'Previously at Google, Meta']
  ])('accepts %s for %s despite %s', (headline, company, description) => {
    expect(classify(headline!, company!, description).decision).toBe('CURRENT');
  });

  it('rejects an explicit other current employer without a requested-company current signal', () => {
    expect(classify('Software Engineer at Google', 'Ramp')).toMatchObject({
      decision: 'CONTRADICTORY', reason: 'EXPLICIT_OTHER_CURRENT_EMPLOYER'
    });
  });

  it('does not turn a historical requested-company mention into current evidence', () => {
    expect(classify('Software Engineer at Google', 'Ramp', 'Previously at Ramp').decision).toBe('CONTRADICTORY');
  });

  it.each([
    ['Software Engineer', 'generic engineering text with no company association'],
    ['John Smith | LinkedIn', 'no usable employment evidence']
  ])('returns insufficient for %s', (headline, description) => {
    expect(classify(headline!, 'Ramp', description).decision).toBe('INSUFFICIENT');
  });

  it('lets a stronger requested-company headline beat weak unrelated snippet text', () => {
    const evidence = classify('Senior Software Engineer @ Ramp', 'Ramp', 'Software Developer at Achilles');
    expect(evidence).toMatchObject({ decision: 'CURRENT', reason: 'CURRENT_HEADLINE_AT_SIGN' });
    expect(evidence.contradictorySignals.length).toBeGreaterThan(0);
  });

  it('keeps a requested-company snippet association when a later segment is historical', () => {
    expect(classify('Software Engineer', 'Ramp', 'Software Engineer at Ramp · Previously at Google')).toMatchObject({
      decision: 'CURRENT', reason: 'CURRENT_SNIPPET_ASSOCIATION'
    });
  });

  it('does not let an alumni suffix inside the result title erase the current headline', () => {
    expect(classify('Software Engineer at Ramp | Waterloo Alumni', 'Ramp')).toMatchObject({
      decision: 'CURRENT', reason: 'CURRENT_HEADLINE_AT_COMPANY'
    });
  });

  it('allows only a stronger explicitly-current contradiction to override a requested headline', () => {
    expect(classify('Software Engineer at Ramp', 'Ramp', 'Currently Software Engineer at Google')).toMatchObject({
      decision: 'CONTRADICTORY', reason: 'EXPLICIT_OTHER_CURRENT_EMPLOYER'
    });
  });

  it('keeps an explicit other-company headline ahead of a weaker requested-company snippet', () => {
    expect(classify('Software Engineer at Google', 'Ramp', 'Building developer infrastructure at Ramp')).toMatchObject({
      decision: 'CONTRADICTORY', reason: 'EXPLICIT_OTHER_CURRENT_EMPLOYER'
    });
  });

  it.each([
    'Present 6 months', 'Present 5 months', 'Remote', 'Waterloo Alumni', 'Full Stack Developer',
    'Data Security', 'Software Engineer', 'Computer Science', 'Greater New York City Area',
    'United States', '500+ connections', 'Followers', 'View profile', 'Experience', 'Education', 'Skills',
    'Building reliable software for customers around the world'
  ])('rejects non-company fragment %s', fragment => {
    expect(isPlausibleCompanyName(fragment)).toBe(false);
  });

  it('records an invalid extracted employer without treating it as contradictory', () => {
    const evidence = classify('Software Engineer at Present 6 months', 'Ramp');
    expect(evidence).toMatchObject({ decision: 'INSUFFICIENT', reason: 'INVALID_CONTRADICTORY_COMPANY_FRAGMENT' });
    expect(evidence.contradictorySignals).toEqual([]);
    expect(evidence.rejectedEmployerFragments).toContain('Present 6 months');
  });

  it.each(['Ramp, Inc.', 'Citigroup', 'Datadog, Inc.', 'IMC Trading LLC', 'JPMorgan Chase & Co.'])
    ('accepts plausible normalized company %s', company => expect(isPlausibleCompanyName(company)).toBe(true));

  it.each([
    ['Software Engineer at Citi', 'Citigroup Inc.'],
    ['Software Engineer at Citigroup Inc.', 'Citi'],
    ['Software Engineer @ Datadog, Inc.', 'Datadog'],
    ['Software Developer at IMC', 'IMC Trading LLC']
  ])('matches generic alias %s to %s', (headline, company) => {
    expect(classify(headline!, company!).decision).toBe('CURRENT');
  });
});

describe('manually labeled obvious-positive corpus', () => {
  const positives = [
    ['Software Engineer at Northstar', 'Northstar'],
    ['Software Developer @ Northstar', 'Northstar'],
    ['Northstar · Backend Engineer', 'Northstar'],
    ['Senior Software Engineer | Northstar', 'Northstar'],
    ['Application Developer - Northstar', 'Northstar'],
    ['Northstar – Full Stack Engineer', 'Northstar'],
    ['Full Stack Developer — Northstar', 'Northstar'],
    ['Software Engineer, Northstar', 'Northstar'],
    ['Software Engineer · Northstar', 'Northstar'],
    ['Software Engineer : Northstar', 'Northstar'],
    ['Software Engineer (Northstar)', 'Northstar'],
    ['Northstar | Senior Backend Engineer', 'Northstar'],
    ['Senior Application Developer at Northstar Inc.', 'Northstar'],
    ['Backend Software Engineer @ Northstar, Inc.', 'Northstar'],
    ['Platform Engineer at Northstar LLC', 'Northstar'],
    ['Senior FE Software Engineer @ Northstar', 'Northstar'],
    ['Software Engineer', 'Northstar', 'Building developer tools at Northstar'],
    ['Backend Engineer', 'Northstar', 'Backend Engineer · Northstar'],
    ['Software Developer', 'Northstar', 'Northstar · Software Developer'],
    ['Full Stack Engineer', 'Northstar', 'Full Stack Engineer | Northstar']
  ] as const;

  it('keeps all manually labeled obvious current employees', () => {
    const decisions = positives.map(([headline, company, description]) => classify(headline, company, description ?? null).decision);
    expect(positives.filter((_, index) => decisions[index] !== 'CURRENT')).toEqual([]);
    expect(decisions.filter(decision => decision === 'CURRENT')).toHaveLength(positives.length);
  });
});
