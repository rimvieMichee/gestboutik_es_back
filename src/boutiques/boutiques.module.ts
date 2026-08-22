import { Module } from '@nestjs/common';
import { BoutiquesController } from './boutiques.controller';
import { BoutiquesService } from './boutiques.service';

@Module({
  controllers: [BoutiquesController],
  providers: [BoutiquesService],
  exports: [BoutiquesService],
})
export class BoutiquesModule {}
