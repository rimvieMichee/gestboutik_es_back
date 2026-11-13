import { ArrayMinSize, IsArray, IsString } from 'class-validator';

/** Boutiques gérées par un gestionnaire (au moins une). */
export class SetUserBoutiquesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  boutiqueIds: string[];
}
