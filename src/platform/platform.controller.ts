import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { PlatformService } from './platform.service';
import { QueryActivityDto } from './dto/query-activity.dto';

// Suivi global réservé au technicien (les gardes JWT/rôles sont globaux).
@Roles(Role.SUPER_ADMIN)
@Controller('platform')
export class PlatformController {
  constructor(private platformService: PlatformService) {}

  @Get('overview')
  overview() {
    return this.platformService.overview();
  }

  @Get('activity')
  activity(@Query() query: QueryActivityDto) {
    return this.platformService.activity(query);
  }
}
