import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { BoutiqueStatus, Role, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword, needsRehash } from '../common/utils/password.util';
import { LoginDto } from './dto/login.dto';
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
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      include: { boutique: true },
    });

    if (!user) {
      throw new UnauthorizedException('Identifiants invalides.');
    }
    if (user.statut !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Ce compte est désactivé.');
    }
    if (
      user.role !== Role.SUPER_ADMIN &&
      (!user.boutique || user.boutique.statut !== BoutiqueStatus.ACTIVE)
    ) {
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
      boutiqueId: user.boutiqueId,
    });

    // Trace de connexion (« dernière connexion » du suivi technicien), sans
    // faire attendre la réponse.
    void this.auditService
      .record({
        action: 'USER_LOGIN',
        entity: 'User',
        entityId: user.id,
        userId: user.id,
        boutiqueId: user.boutiqueId,
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
        boutiqueId: user.boutiqueId,
        boutique: user.boutique
          ? {
              id: user.boutique.id,
              nom: user.boutique.nom,
              statut: user.boutique.statut,
            }
          : null,
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
      include: { boutique: true },
    });
    if (!user || user.statut !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Compte désactivé.');
    }
    if (
      user.role !== Role.SUPER_ADMIN &&
      (!user.boutique || user.boutique.statut !== BoutiqueStatus.ACTIVE)
    ) {
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
      boutiqueId: user.boutiqueId,
    });
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
    const refreshToken = await this.jwtService.signAsync(payload, {
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
