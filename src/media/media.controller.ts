import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { MediaService } from './media.service';

const MAX_SIZE = 5 * 1024 * 1024;

@Controller('media')
export class MediaController {
  constructor(private mediaService: MediaService) {}

  // Le gestionnaire envoie l'image d'un produit ; l'URL renvoyée est ensuite
  // passée dans le champ `image` de la création/modification du produit.
  @Roles(Role.ADMIN)
  @Post('product-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SIZE, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (!/^image\/(jpe?g|png|webp)$/.test(file.mimetype)) {
          return cb(
            new BadRequestException(
              'Format non supporté (JPEG, PNG ou WebP uniquement).',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  uploadProductImage(@UploadedFile() file: Express.Multer.File) {
    return this.mediaService.uploadImage(file);
  }
}
