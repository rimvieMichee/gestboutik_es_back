import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { resolveBoutiqueScope, assertSameBoutique } from './tenant-scope.util';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

const employee = (boutiqueId: string | null): AuthenticatedUser => ({
  userId: 'u1',
  username: 'emp',
  role: Role.EMPLOYEE,
  boutiqueId,
});

const admin: AuthenticatedUser = {
  userId: 'a1',
  username: 'admin',
  role: Role.SUPER_ADMIN,
  boutiqueId: null,
};

describe('resolveBoutiqueScope', () => {
  it("force la boutique de l'employé, même sans filtre demandé", () => {
    expect(resolveBoutiqueScope(employee('b1'))).toBe('b1');
  });

  it('laisse passer un employé qui demande explicitement sa propre boutique', () => {
    expect(resolveBoutiqueScope(employee('b1'), 'b1')).toBe('b1');
  });

  it('refuse un employé qui demande une autre boutique', () => {
    expect(() => resolveBoutiqueScope(employee('b1'), 'b2')).toThrow(
      ForbiddenException,
    );
  });

  it('refuse un employé sans boutique associée', () => {
    expect(() => resolveBoutiqueScope(employee(null))).toThrow(
      ForbiddenException,
    );
  });

  it('laisse le SUPER_ADMIN filtrer librement (ou voir toutes les boutiques)', () => {
    expect(resolveBoutiqueScope(admin, 'b2')).toBe('b2');
    expect(resolveBoutiqueScope(admin)).toBeUndefined();
  });
});

describe('assertSameBoutique', () => {
  it('ne bloque pas le SUPER_ADMIN, quelle que soit la boutique de la ressource', () => {
    expect(() => assertSameBoutique(admin, 'autre-boutique')).not.toThrow();
  });

  it('laisse passer un employé sur une ressource de sa boutique', () => {
    expect(() => assertSameBoutique(employee('b1'), 'b1')).not.toThrow();
  });

  it("bloque un employé sur une ressource d'une autre boutique", () => {
    expect(() => assertSameBoutique(employee('b1'), 'b2')).toThrow(
      ForbiddenException,
    );
  });
});
