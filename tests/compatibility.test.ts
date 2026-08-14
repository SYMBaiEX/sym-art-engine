import { beforeAll, describe, expect, it } from 'vitest';
import { loadProject, type LoadedProject } from '../src/config/loadProject.js';
import {
  checkCandidate,
  evaluateSet,
  pendingRequirementsFor,
} from '../src/engine/compatibility.js';
import { evaluatePalette } from '../src/engine/palette.js';
import { evaluateSynergy } from '../src/engine/synergy.js';
import { traitMatchesSelector } from '../src/engine/selectors.js';
import type { Trait } from '../src/schemas/trait.js';
import { createFixtureProject } from './helpers/fixtureProject.js';

let project: LoadedProject;
const t = (id: string): Trait => project.traitById.get(id) as Trait;

beforeAll(async () => {
  project = loadProject(await createFixtureProject());
});

describe('selector grammar', () => {
  it('matches trait:, tag:, category:, family, and public-name selectors', () => {
    expect(traitMatchesSelector('trait:hat_cap', t('hat_cap'), project)).toBe(true);
    expect(traitMatchesSelector('tag:casual', t('hat_cap'), project)).toBe(true);
    expect(traitMatchesSelector('category:hat', t('hat_cap'), project)).toBe(true);
    expect(traitMatchesSelector('hat:cap', t('hat_cap'), project)).toBe(true);
    expect(traitMatchesSelector('Hat:Cap', t('hat_cap'), project)).toBe(true);
    expect(traitMatchesSelector('hat:crown', t('hat_cap'), project)).toBe(false);
    expect(traitMatchesSelector('aura:none', t('aura_none'), project)).toBe(true);
  });
});

describe('compatibility rules', () => {
  it('blocks by tag (chaos aura blocks tag:casual cap)', () => {
    const violations = checkCandidate(t('aura_chaos'), [t('hat_cap')], project);
    expect(violations.some((v) => v.rule === 'blocks')).toBe(true);
    // symmetric: candidate cap against selected chaos
    const reverse = checkCandidate(t('hat_cap'), [t('aura_chaos')], project);
    expect(reverse.some((v) => v.rule === 'blocks')).toBe(true);
  });

  it('scoped allows: cap only allows aura none/soft', () => {
    expect(checkCandidate(t('aura_soft'), [t('hat_cap')], project)).toHaveLength(0);
    expect(checkCandidate(t('aura_none'), [t('hat_cap')], project)).toHaveLength(0);
    const violations = checkCandidate(t('aura_chaos'), [t('hat_cap')], project);
    expect(violations.some((v) => v.rule === 'allows')).toBe(true);
  });

  it('requires is enforced immediately against selected categories', () => {
    // crown requires body:standard — body_blue satisfies it
    expect(checkCandidate(t('hat_crown'), [t('body_blue')], project)).toHaveLength(0);
  });

  it('requires surfaces as pending for not-yet-selected categories', () => {
    const pending = pendingRequirementsFor('body', [t('hat_crown')], project);
    expect(pending).toEqual(['body:standard']);
  });

  it('exclusive groups reject a second member', () => {
    const violations = checkCandidate(t('aura_soft'), [t('hat_crown')], project);
    expect(violations.some((v) => v.rule === 'exclusive-group')).toBe(true);
  });

  it('conditional rules activate from selected traits', () => {
    const violations = checkCandidate(t('aura_chaos'), [t('hat_crown')], project);
    expect(violations.some((v) => v.rule === 'conditional-blocks')).toBe(true);
  });

  it('evaluateSet flags unsatisfied requires', () => {
    const violations = evaluateSet([t('hat_crown'), t('bg_red')], project);
    expect(violations.some((v) => v.rule === 'requires')).toBe(true);
  });
});

describe('synergy + palette scoring', () => {
  it('sums matched synergy rules', () => {
    const result = evaluateSynergy([t('hat_cap'), t('aura_soft')], project);
    expect(result.score).toBe(2);
    expect(result.matches).toHaveLength(1);
  });

  it('scores contrast and relationships', () => {
    const good = evaluatePalette([t('bg_red'), t('body_blue')], project);
    // contrast 0.6 over target 0.5 -> 100, +10 preferred, clamped
    expect(good.score).toBe(100);
    expect(good.preferred).toHaveLength(1);

    const bad = evaluatePalette([t('bg_dark'), t('body_blue')], project);
    // contrast 0.1 below minContrast 0.15 -> blocked
    expect(bad.blocked.length).toBeGreaterThan(0);
    expect(bad.score).toBe(0);
    expect(bad.discouraged).toHaveLength(1);
  });
});
