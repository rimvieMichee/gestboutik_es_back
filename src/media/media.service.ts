import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

export interface UploadedImage {
  url: string;
  publicId: string;
}

@Injectable()
export class MediaService {
  private readonly folder: string;
  private readonly configured: boolean;

  constructor(config: ConfigService) {
    const cloudName = config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = config.get<string>('CLOUDINARY_API_SECRET');
    this.folder = config.get<string>('CLOUDINARY_FOLDER') || 'gestion';
    this.configured = !!(cloudName && apiKey && apiSecret);
    if (this.configured) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
    }
  }

  /** Envoie une image dans le dossier Cloudinary configuré (« gestion »). */
  uploadImage(file: Express.Multer.File): Promise<UploadedImage> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        "Le stockage d'images n'est pas configuré (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).",
      );
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('Aucun fichier reçu.');
    }
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: this.folder,
            resource_type: 'image',
            // Réduit les images trop lourdes prises depuis un téléphone.
            transformation: [{ width: 1200, height: 1200, crop: 'limit' }],
          },
          (error, result) => {
            if (error || !result) {
              return reject(
                new InternalServerErrorException(
                  "Échec de l'envoi de l'image.",
                ),
              );
            }
            resolve({ url: result.secure_url, publicId: result.public_id });
          },
        )
        .end(file.buffer);
    });
  }
}
