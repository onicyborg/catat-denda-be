import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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
  ValidateIf,
} from 'class-validator';
import { EntryKind } from '../generated/prisma/client.js';
export class PeriodQuery {
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
export class ReportQuery extends PeriodQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() violationTypeId?: string;
}
export class BalanceQuery extends ReportQuery {
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
export enum ExportStatus {
  POSTED = 'POSTED',
  DRAFT = 'DRAFT',
  VOIDED = 'VOIDED',
  ALL = 'ALL',
}
export class CaseReportQuery extends BalanceQuery {
  @ApiPropertyOptional({ enum: ExportStatus, default: ExportStatus.POSTED })
  @IsEnum(ExportStatus)
  status = ExportStatus.POSTED;
  @ApiPropertyOptional({ default: false })
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  includeUndated = false;
}
export class PaymentExportQuery extends ReportQuery {
  @ApiPropertyOptional({ enum: EntryKind })
  @IsOptional()
  @IsEnum(EntryKind)
  kind?: EntryKind;
}
export class AuditQuery extends PeriodQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorUserId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;
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
export class SettingsDto {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
  @ApiPropertyOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.normalize('NFC').trim().replace(/\s+/gu, ' ')
      : value,
  )
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  businessName?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  @Matches(/^(?:[^\p{Cc}\p{Cs}]|\n|\r|\t)*$/u)
  finePolicyReference?: string | null;
}
