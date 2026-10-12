import { describe, expect, it } from 'vitest';
import {
  getReceptionCapsuleSize,
  getWindowSizeConstraints,
  getWindowSizeForView,
  isLargePanelView,
  isLargeWorkspaceView,
  supportsPersistentWindowSize,
} from './windowSizes';

describe('getReceptionCapsuleSize', () => {
  it('avoids a fixed tall blank area for a short risk list', () => {
    expect(getReceptionCapsuleSize({ expanded: true, riskCount: 1 })).toEqual({
      width: 280,
      height: 196,
    });
    expect(getReceptionCapsuleSize({ expanded: true, riskCount: 4 })).toEqual({
      width: 280,
      height: 316,
    });
  });

  it('reserves action space and caps the capsule height', () => {
    expect(getReceptionCapsuleSize({
      expanded: true,
      riskCount: 8,
      hasChronicRefill: true,
      hasReportInterpretation: true,
    })).toEqual({
      width: 280,
      height: 520,
    });
  });

  it('reserves compact inline space while choosing a multi-disease refill scope', () => {
    expect(getReceptionCapsuleSize({
      expanded: false,
      hasChronicRefill: true,
      chronicScopeSelecting: true,
    })).toEqual({
      width: 320,
      height: 300,
    });
  });
});

describe('patient memory workspace', () => {
  it('uses a readable bounded workspace size', () => {
    expect(getWindowSizeForView('patient-memory')).toEqual({
      width: 1120,
      height: 760,
    });
    expect(getWindowSizeConstraints('patient-memory')).toEqual({
      minWidth: 980,
      minHeight: 620,
    });
  });
});

describe('outpatient EMR workspace', () => {
  it('uses a persistent large workspace with a bounded minimum size', () => {
    expect(getWindowSizeForView('outpatient-emr')).toEqual({
      width: 1120,
      height: 760,
    });
    expect(getWindowSizeConstraints('outpatient-emr')).toEqual({
      minWidth: 900,
      minHeight: 620,
    });
    expect(isLargePanelView('outpatient-emr')).toBe(true);
    expect(isLargeWorkspaceView('outpatient-emr')).toBe(true);
    expect(supportsPersistentWindowSize('outpatient-emr')).toBe(true);
  });
});

describe('public health workspace', () => {
  it('participates in bounded persistent workspace geometry', () => {
    expect(getWindowSizeForView('public-health')).toEqual({ width: 1120, height: 760 });
    expect(getWindowSizeConstraints('public-health')).toEqual({ minWidth: 900, minHeight: 620 });
    expect(isLargePanelView('public-health')).toBe(true);
    expect(isLargeWorkspaceView('public-health')).toBe(true);
    expect(supportsPersistentWindowSize('public-health')).toBe(true);
  });
});
