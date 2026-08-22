import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role, UserStatus, BoutiqueStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AuthenticatedUser,
  JwtPayload,
} from '../types/authenticated-user.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') as string,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // Revérifie l'état en base à chaque requête : une désactivation (user ou boutique)
    // doit être effective immédiatement, sans attendre l'expiration du token.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { boutique: true },
    });

    if (!user || user.statut !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Compte désactivé ou introuvable.');
    }

    if (user.role !== Role.SUPER_ADMIN) {
      if (!user.boutique || user.boutique.statut !== BoutiqueStatus.ACTIVE) {
        throw new UnauthorizedException('Boutique désactivée.');
      }
    }

    return {
      userId: user.id,
      username: user.username,
      role: user.role,
      boutiqueId: user.boutiqueId,
    };
  }
}
