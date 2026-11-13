import { UnauthorizedException } from '@nestjs/common';
import { BoutiqueStatus, Role, UserStatus } from '@prisma/client';
import { AuthCacheService } from './auth-cache.service';
import {
  AuthValidatorService,
  pickActiveBoutique,
} from './auth-validator.service';

describe('pickActiveBoutique', () => {
  const m = [
    { id: 'a', actif: true },
    { id: 'b', actif: false },
    { id: 'c', actif: true },
  ];
  it('garde la boutique demandée si elle est gérée et active', () => {
    expect(pickActiveBoutique(m, 'c', 'a')).toBe('c');
  });
  it('retombe sur la boutique par défaut si la demandée est inactive', () => {
    expect(pickActiveBoutique(m, 'b', 'c')).toBe('c');
  });
  it('retombe sur la première boutique active', () => {
    expect(pickActiveBoutique(m, 'zzz', 'b')).toBe('a');
  });
  it('renvoie null si aucune boutique active', () => {
    expect(pickActiveBoutique([{ id: 'a', actif: false }], 'a', 'a')).toBeNull();
    expect(pickActiveBoutique([])).toBeNull();
  });
});

describe('AuthValidatorService : boutique active de la session', () => {
  const user = (over: Record<string, unknown>) => ({
    id: 'u1',
    username: 'issa',
    role: Role.ADMIN,
    statut: UserStatus.ACTIVE,
    boutiqueId: 'a',
    boutique: { statut: BoutiqueStatus.ACTIVE },
    boutiques: [
      { boutiqueId: 'a', boutique: { statut: BoutiqueStatus.ACTIVE } },
      { boutiqueId: 'b', boutique: { statut: BoutiqueStatus.ACTIVE } },
    ],
    ...over,
  });
  const make = (row: ReturnType<typeof user> | null) => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(row) },
    };
    const svc = new AuthValidatorService(
      prisma as never,
      new AuthCacheService(),
    );
    return { svc, prisma };
  };

  it("un gestionnaire travaille sur la boutique de son jeton", async () => {
    const { svc } = make(user({}));
    expect((await svc.validate('u1', 'b')).boutiqueId).toBe('b');
    expect((await svc.validate('u1', 'a')).boutiqueId).toBe('a');
  });

  it('sans boutique dans le jeton, on prend la boutique par défaut', async () => {
    const { svc } = make(user({ boutiqueId: 'b' }));
    expect((await svc.validate('u1')).boutiqueId).toBe('b');
  });

  it("refuse une boutique qu'il ne gère pas (ou plus)", async () => {
    const { svc } = make(user({}));
    await expect(svc.validate('u1', 'autre')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuse la session si la boutique du jeton est désactivée', async () => {
    const { svc } = make(
      user({
        boutiques: [
          { boutiqueId: 'a', boutique: { statut: BoutiqueStatus.INACTIVE } },
          { boutiqueId: 'b', boutique: { statut: BoutiqueStatus.ACTIVE } },
        ],
      }),
    );
    await expect(svc.validate('u1', 'a')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // L'autre boutique, active, reste utilisable.
    expect((await svc.validate('u1', 'b')).boutiqueId).toBe('b');
  });

  it("un employé reste sur sa boutique, quoi que dise le jeton", async () => {
    const { svc } = make(
      user({ role: Role.EMPLOYEE, boutiqueId: 'a', boutiques: [] }),
    );
    expect((await svc.validate('u1', 'b')).boutiqueId).toBe('a');
  });

  it("un gestionnaire antérieur au rattachement multiple garde sa boutique", async () => {
    const { svc } = make(user({ boutiques: [] }));
    expect((await svc.validate('u1', 'a')).boutiqueId).toBe('a');
    expect((await svc.validate('u1')).boutiqueId).toBe('a');
  });

  it('refuse un compte désactivé', async () => {
    const { svc } = make(user({ statut: UserStatus.INACTIVE }));
    await expect(svc.validate('u1', 'a')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("mémorise l'état du compte mais pas la boutique choisie", async () => {
    const { svc, prisma } = make(user({}));
    await svc.validate('u1', 'a');
    await svc.validate('u1', 'b');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });
});
