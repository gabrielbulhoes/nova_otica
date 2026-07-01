import { describe, it, expect } from 'vitest';
import { classifyABC } from '../src/modules/reports/reports.service.js';

describe('classifyABC', () => {
  it('classe A até 80% acumulado', () => {
    expect(classifyABC(10)).toBe('A');
    expect(classifyABC(80)).toBe('A');
  });

  it('classe B entre 80% e 95%', () => {
    expect(classifyABC(80.1)).toBe('B');
    expect(classifyABC(95)).toBe('B');
  });

  it('classe C acima de 95%', () => {
    expect(classifyABC(95.1)).toBe('C');
    expect(classifyABC(100)).toBe('C');
  });
});
