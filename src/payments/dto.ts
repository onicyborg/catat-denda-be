import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntryKind, Method } from '../generated/prisma/client.js';
const trim = Transform(({ value }) =>
  typeof value === 'string' ? value.trim() : value,
);
export class PaymentDto {
  @ApiProperty({ minimum: 1, maximum: 100000000 })
  @IsInt()
  @Min(1)
  @Max(100000000)
  amount!: number;
  @ApiProperty({ enum: Method }) @IsEnum(Method) method!: Method;
  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  effectiveAt!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Matches(/^(?:[^\p{Cc}\p{Cs}]|\n|\r|\t)*$/u)
  @trim
  note?: string | null;
}
export class ReverseDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @trim
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  @Matches(/^(?:[^\p{Cc}\p{Cs}]|\n|\r|\t)*$/u)
  reason!: string;
  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  effectiveAt!: string;
}
export class PaymentQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() caseId?: string;
  @ApiPropertyOptional({ enum: EntryKind })
  @IsOptional()
  @IsEnum(EntryKind)
  kind?: EntryKind;
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;
  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
