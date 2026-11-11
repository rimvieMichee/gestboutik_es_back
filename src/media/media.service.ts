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
  private readonly missing: string[];

  constructor(config: ConfigService) {
    // Tolère les espaces et guillemets collés par erreur dans le dashboard de l'hébergeur.
    const read = (name: string) =>
      (config.get<string>(name) ?? '').trim().replace(/^["']|["']$/g, '');
    const cloudName = read('CLOUDINARY_CLOUD_NAME');
    const apiKey = read('CLOUDINARY_API_KEY');
    const apiSecret = read('CLOUDINARY_API_SECRET');
    this.folder = read('CLOUDINARY_FOLDER') || 'gestion';
    this.missing = [
      ['CLOUDINARY_CLOUD_NAME', cloudName],
      ['CLOUDINARY_API_KEY', apiKey],
      ['CLOUDINARY_API_SECRET', apiSecret],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    this.configured = this.missing.length === 0;
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
        `Le stockage d'images n'est pas configuré. Variables manquantes ou vides : ${this.missing.join(', ')}.`,
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
