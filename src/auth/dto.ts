import {
  IsEmail,
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class LoginDto {
  @ApiPropertyOptional({
    description: 'Username atau email akun lama. Kirim tepat satu identifier.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  username?: string;
  @ApiPropertyOptional({
    deprecated: true,
    description: 'Kompatibilitas akun lama; gunakan username untuk login baru.',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(256) password!: string;
}
export class PasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;
  @ApiProperty()
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  newPassword!: string;
}
