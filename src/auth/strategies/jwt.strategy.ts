import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role, UserStatus, BoutiqueStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthCacheService } from '../auth-cache.service';
import {
  AuthenticatedUser,
  JwtPayload,
} from '../types/authenticated-user.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private authCache: AuthCacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') as string,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // Une désactivation (compte ou boutique) doit être effective immédiatement :
    // l'état est revérifié en base, mais mémorisé quelques secondes et invalidé
    // dès qu'un statut change (voir AuthCacheService).
    const cached = this.authCache.get(payload.sub);
    if (cached) return cached;

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        username: true,
        role: true,
        statut: true,
        boutiqueId: true,
        boutique: { select: { statut: true } },
      },
    });

    if (!user || user.statut !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Compte désactivé ou introuvable.');
    }

    if (user.role !== Role.SUPER_ADMIN) {
      if (!user.boutique || user.boutique.statut !== BoutiqueStatus.ACTIVE) {
        throw new UnauthorizedException('Boutique désactivée.');
      }
    }

    const authenticated: AuthenticatedUser = {
      userId: user.id,
      username: user.username,
      role: user.role,
      boutiqueId: user.boutiqueId,
    };
    this.authCache.set(user.id, authenticated);
    return authenticated;
  }
}
