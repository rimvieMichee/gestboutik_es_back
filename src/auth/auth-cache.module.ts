import { Global, Module } from '@nestjs/common';
import { AuthCacheService } from './auth-cache.service';
import { AuthValidatorService } from './auth-validator.service';

@Global()
@Module({
  providers: [AuthCacheService, AuthValidatorService],
  exports: [AuthCacheService, AuthValidatorService],
})
export class AuthCacheModule {}
