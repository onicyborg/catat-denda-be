import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class LoginDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
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
