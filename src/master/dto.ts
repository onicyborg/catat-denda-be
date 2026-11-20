import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Category } from '../generated/prisma/client.js';
export const clean = (value: unknown) =>
  typeof value === 'string'
    ? value.normalize('NFC').trim().replace(/\s+/gu, ' ')
    : value;
export const normalizeName = (name: string) =>
  (clean(name) as string).toLowerCase();
const trim = Transform(({ value }) => clean(value));
const code = Transform(({ value }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || null : value,
);
const text = Transform(({ value }) =>
  typeof value === 'string' ? value.trim() || null : value,
);
export enum MasterStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ALL = 'ALL',
}
export class MasterQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @trim
  q?: string;
  @ApiPropertyOptional({ enum: MasterStatus, default: MasterStatus.ACTIVE })
  @IsEnum(MasterStatus)
  status: MasterStatus = MasterStatus.ACTIVE;
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
export class ViolationQuery extends MasterQuery {
  @ApiPropertyOptional({ enum: Category })
  @IsOptional()
  @IsEnum(Category)
  category?: Category;
}
export class EmployeeCreateDto {
  @ApiProperty()
  @trim
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  displayName!: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @code
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  employeeCode?: string | null;
}
export class EmployeeUpdateDto {
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @trim
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  displayName?: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @code
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  employeeCode?: string | null;
}
export class AliasDto {
  @ApiProperty()
  @trim
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  aliasDisplay!: string;
}
export class ViolationCreateDto {
  @ApiProperty() @code @IsString() @Matches(/^[A-Z0-9_-]{2,40}$/) code!: string;
  @ApiProperty() @trim @IsString() @MinLength(3) @MaxLength(120) name!: string;
  @ApiProperty({ enum: Category }) @IsEnum(Category) category!: Category;
  @ApiProperty({ minimum: 1, maximum: 100000000 })
  @IsInt()
  @Min(1)
  @Max(100000000)
  defaultAmountPerPerson!: number;
  @ApiPropertyOptional({ type: String, nullable: true })
  @text
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Matches(/^(?:[^\p{Cc}\p{Cs}]|\n|\r|\t)*$/u)
  description?: string | null;
}
export class ViolationUpdateDto {
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @code
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,40}$/)
  code?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @trim
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  name?: string;
  @ApiPropertyOptional({ enum: Category })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(Category)
  category?: Category;
  @ApiPropertyOptional({ minimum: 1, maximum: 100000000 })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(100000000)
  defaultAmountPerPerson?: number;
  @ApiPropertyOptional({ type: String, nullable: true })
  @text
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Matches(/^(?:[^\p{Cc}\p{Cs}]|\n|\r|\t)*$/u)
  description?: string | null;
}
export class EmptyDto {}
