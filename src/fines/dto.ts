import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CaseStatus } from '../generated/prisma/client.js';
const uuidCase = Transform(({ value }) =>
  typeof value === 'string' ? value.toLowerCase() : value,
);
const trim = Transform(({ value }) =>
  typeof value === 'string' ? value.trim() : value,
);
export class FineMemberDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @uuidCase
  @IsUUID()
  employeeId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/^[^\p{Cc}\p{Cs}]*$/u)
  @trim
  rawEmployeeName?: string | null;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 1,
    maximum: 100000000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000000)
  assignedAmount?: number | null;
}
export class FineCreateDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsDateString({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  occurredAt?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @uuidCase
  @IsUUID()
  violationTypeId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Matches(/^(?:[^\p{Cc}\p{Cs}]|\n|\r|\t)*$/u)
  @trim
  description?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  @Matches(/^(?:[^\p{Cc}\p{Cs}]|\n|\r|\t)*$/u)
  sourceText?: string | null;
  @ApiPropertyOptional({ type: [FineMemberDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => FineMemberDto)
  members?: FineMemberDto[];
}
export class FineUpdateDto extends FineCreateDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}
export class FineVersionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}
export class FineVoidDto extends FineVersionDto {
  @ApiProperty()
  @trim
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
export class FineQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @trim
  q?: string;
  @ApiPropertyOptional({ enum: CaseStatus })
  @IsOptional()
  @IsEnum(CaseStatus)
  status?: CaseStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() violationTypeId?: string;
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
