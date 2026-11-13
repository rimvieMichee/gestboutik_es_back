import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Boutique, BoutiqueStatus, Role, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword, needsRehash } from '../common/utils/password.util';
import { LoginDto } from './dto/login.dto';
import { SwitchBoutiqueDto } from './dto/switch-boutique.dto';
import { AuthCacheService } from './auth-cache.service';
import { pickActiveBoutique } from './auth-validator.service';
import { JwtPayload } from './types/authenticated-user.type';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private auditService: AuditService,
    private authCache: AuthCacheService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      include: {
        boutique: true,
        boutiques: { include: { boutique: true }, orderBy: { createdAt: 'asc' } },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Identifiants invalides.');
    }
    if (user.statut !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Ce compte est désactivé.');
    }
    // Boutique de la session : celle d'un employé, ou la dernière boutique
    // utilisée par un gestionnaire (à défaut, la première encore active).
    const activeBoutiqueId = this.sessionBoutiqueId(user);
    if (user.role !== Role.SUPER_ADMIN && !activeBoutiqueId) {
      throw new UnauthorizedException('Cette boutique est désactivée.');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    // Les comptes créés avec un coût de hachage élevé se connectent lentement :
    // on remplace silencieusement leur hash, sans faire attendre la réponse.
    if (needsRehash(user.passwordHash)) {
      void hashPassword(dto.password)
        .then((passwordHash) =>
          this.prisma.user.update({
            where: { id: user.id },
            data: { passwordHash },
          }),
        )
        .catch(() => undefined);
    }

    const tokens = await this.issueTokenPair({
      sub: user.id,
      username: user.username,
      role: user.role,
      boutiqueId: activeBoutiqueId,
    });
    // La boutique par défaut suit la dernière utilisée (reprise à la prochaine connexion).
    if (user.role === Role.ADMIN && activeBoutiqueId !== user.boutiqueId) {
      void this.prisma.user
        .update({ where: { id: user.id }, data: { boutiqueId: activeBoutiqueId } })
        .catch(() => undefined);
    }
    const activeBoutique =
      user.role === Role.ADMIN
        ? (this.membershipsOf(user).find(
            (m) => m.boutiqueId === activeBoutiqueId,
          )?.boutique ?? null)
        : user.boutique;

    // Trace de connexion (« dernière connexion » du suivi technicien), sans
    // faire attendre la réponse.
    void this.auditService
      .record({
        action: 'USER_LOGIN',
        entity: 'User',
        entityId: user.id,
        userId: user.id,
        boutiqueId: activeBoutiqueId,
      })
      .catch(() => undefined);

    return {
      ...tokens,
      user: {
        id: user.id,
        nom: user.nom,
        prenom: user.prenom,
        username: user.username,
        role: user.role,
        boutiqueId: activeBoutiqueId,
        boutique: activeBoutique
          ? {
              id: activeBoutique.id,
              nom: activeBoutique.nom,
              statut: activeBoutique.statut,
            }
          : null,
        // Boutiques que ce gestionnaire peut ouvrir (vide pour les autres rôles).
        boutiques: this.boutiquesOf(user),
      },
    };
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalide ou expiré.');
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (
      !stored ||
      stored.revoked ||
      stored.expiresAt < new Date() ||
      stored.userId !== payload.sub
    ) {
      throw new UnauthorizedException('Refresh token invalide ou expiré.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        boutique: true,
        boutiques: { include: { boutique: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!user || user.statut !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Compte désactivé.');
    }
    // La session garde sa boutique tant qu'elle reste gérée et active.
    const activeBoutiqueId = this.sessionBoutiqueId(user, payload.boutiqueId);
    if (user.role !== Role.SUPER_ADMIN && !activeBoutiqueId) {
      throw new UnauthorizedException('Boutique désactivée.');
    }

    // Rotation : on révoque l'ancien refresh token et on en émet un nouveau.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });

    return this.issueTokenPair({
      sub: user.id,
      username: user.username,
      role: user.role,
      boutiqueId: activeBoutiqueId,
    });
  }

  /**
   * Un gestionnaire change de boutique active : la session reçoit de nouveaux
   * jetons liés à cette boutique, et elle devient sa boutique par défaut.
   */
  async switchBoutique(userId: string, dto: SwitchBoutiqueDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        boutique: true,
        boutiques: { include: { boutique: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!user || user.statut !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Compte désactivé.');
    }
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Seul un gestionnaire peut changer de boutique.',
      );
    }
    const target = this.membershipsOf(user).find(
      (m) => m.boutiqueId === dto.boutiqueId,
    );
    if (!target) {
      throw new ForbiddenException("Vous ne gérez pas cette boutique.");
    }
    if (target.boutique.statut !== BoutiqueStatus.ACTIVE) {
      throw new BadRequestException('Cette boutique est désactivée.');
    }

    // Le refresh token fourni doit appartenir à cette session ; il est remplacé.
    const revoked = await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        tokenHash: this.hashToken(dto.refreshToken),
        revoked: false,
        expiresAt: { gt: new Date() },
      },
      data: { revoked: true },
    });
    if (revoked.count === 0) {
      throw new UnauthorizedException('Session invalide ou expirée.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { boutiqueId: dto.boutiqueId },
    });
    this.authCache.invalidateUser(userId);

    const tokens = await this.issueTokenPair({
      sub: user.id,
      username: user.username,
      role: user.role,
      boutiqueId: dto.boutiqueId,
    });
    void this.auditService
      .record({
        action: 'BOUTIQUE_SWITCHED',
        entity: 'User',
        entityId: user.id,
        userId: user.id,
        boutiqueId: dto.boutiqueId,
      })
      .catch(() => undefined);

    return {
      ...tokens,
      boutiqueId: dto.boutiqueId,
      boutique: {
        id: target.boutique.id,
        nom: target.boutique.nom,
        statut: target.boutique.statut,
      },
      boutiques: this.boutiquesOf(user),
    };
  }

  /**
   * Boutiques gérées par un gestionnaire. Un compte antérieur au rattachement
   * multiple n'a pas encore de ligne dédiée : sa boutique reste la sienne.
   */
  private membershipsOf(user: {
    role: Role;
    boutiqueId: string | null;
    boutique: Boutique | null;
    boutiques: Array<{ boutiqueId: string; boutique: Boutique }>;
  }): Array<{ boutiqueId: string; boutique: Boutique }> {
    if (
      user.role === Role.ADMIN &&
      user.boutiqueId &&
      user.boutique &&
      !user.boutiques.some((m) => m.boutiqueId === user.boutiqueId)
    ) {
      return [
        { boutiqueId: user.boutiqueId, boutique: user.boutique },
        ...user.boutiques,
      ];
    }
    return user.boutiques;
  }

  /** Boutique active d'une nouvelle session ou d'un renouvellement. */
  private sessionBoutiqueId(
    user: {
      role: Role;
      boutiqueId: string | null;
      boutique: Boutique | null;
      boutiques: Array<{ boutiqueId: string; boutique: Boutique }>;
    },
    preferred?: string | null,
  ): string | null {
    if (user.role === Role.SUPER_ADMIN) return null;
    if (user.role === Role.ADMIN) {
      return pickActiveBoutique(
        this.membershipsOf(user).map((m) => ({
          id: m.boutiqueId,
          actif: m.boutique.statut === BoutiqueStatus.ACTIVE,
        })),
        preferred,
        user.boutiqueId,
      );
    }
    return user.boutique?.statut === BoutiqueStatus.ACTIVE
      ? user.boutiqueId
      : null;
  }

  private boutiquesOf(user: {
    role: Role;
    boutiqueId: string | null;
    boutique: Boutique | null;
    boutiques: Array<{ boutiqueId: string; boutique: Boutique }>;
  }) {
    if (user.role !== Role.ADMIN) return [];
    return this.membershipsOf(user).map((m) => ({
      id: m.boutique.id,
      nom: m.boutique.nom,
      ville: m.boutique.ville,
      statut: m.boutique.statut,
    }));
  }

  async logout(userId: string, refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash, revoked: false },
      data: { revoked: true },
    });
    return { success: true };
  }

  private async issueTokenPair(payload: JwtPayload): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>(
        'JWT_ACCESS_EXPIRES_IN',
      ) as JwtSignOptions['expiresIn'],
    });
    // `jwtid` rend chaque refresh token unique : deux émissions dans la même
    // seconde (connexion puis changement de boutique) auraient sinon le même
    // contenu, donc le même hash en base.
    const refreshToken = await this.jwtService.signAsync(payload, {
      jwtid: randomUUID(),
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>(
        'JWT_REFRESH_EXPIRES_IN',
      ) as JwtSignOptions['expiresIn'],
    });

    const decoded = this.jwtService.decode<{ exp: number }>(refreshToken);
    await this.prisma.refreshToken.create({
      data: {
        userId: payload.sub,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(decoded.exp * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
