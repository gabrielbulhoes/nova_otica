import { describe, it, expect } from 'vitest';
import { isWithinWindow } from '../src/integrations/sellbie/window.js';

/** Constrói uma data no horário HH:MM local do dia. */
const at = (hh: number, mm = 0) => {
  const d = new Date(2024, 5, 15, hh, mm, 0);
  return d;
};

describe('isWithinWindow (janela 06:00–07:00)', () => {
  it('inclui o início e exclui o fim', () => {
    expect(isWithinWindow(at(6, 0), '06:00', '07:00')).toBe(true);
    expect(isWithinWindow(at(6, 59), '06:00', '07:00')).toBe(true);
    expect(isWithinWindow(at(7, 0), '06:00', '07:00')).toBe(false);
  });

  it('bloqueia fora da janela', () => {
    expect(isWithinWindow(at(5, 59), '06:00', '07:00')).toBe(false);
    expect(isWithinWindow(at(12, 0), '06:00', '07:00')).toBe(false);
    expect(isWithinWindow(at(0, 0), '06:00', '07:00')).toBe(false);
  });

  it('suporta janela que cruza a meia-noite', () => {
    expect(isWithinWindow(at(23, 30), '22:00', '02:00')).toBe(true);
    expect(isWithinWindow(at(1, 0), '22:00', '02:00')).toBe(true);
    expect(isWithinWindow(at(3, 0), '22:00', '02:00')).toBe(false);
  });
});
