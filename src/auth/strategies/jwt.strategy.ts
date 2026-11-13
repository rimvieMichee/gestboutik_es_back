import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthValidatorService } from '../auth-validator.service';
import {
  AuthenticatedUser,
  JwtPayload,
} from '../types/authenticated-user.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private validator: AuthValidatorService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') as string,
    });
  }

  validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // La boutique active vient du jeton : deux appareils d'un même gestionnaire
    // peuvent travailler sur deux boutiques différentes.
    return this.validator.validate(payload.sub, payload.boutiqueId);
  }
}
