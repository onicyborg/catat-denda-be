import { ApiProperty } from '@nestjs/swagger';
import { PageMetaResponse } from '../pagination.js';
export class ReportSummaryResponse {
  @ApiProperty() exportMaxDays!: number;
  @ApiProperty() exportMaxRows!: number;
  @ApiProperty() businessName!: string;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() generatedAt!: string;
  @ApiProperty({ type: String, nullable: true }) employeeId!: string | null;
  @ApiProperty({ type: String, nullable: true }) violationTypeId!:
    string | null;
  @ApiProperty() caseCount!: string;
  @ApiProperty() allocationCount!: string;
  @ApiProperty() assessedAmount!: string;
  @ApiProperty() cohortNetPaidAmount!: string;
  @ApiProperty() cohortOutstandingAmount!: string;
  @ApiProperty() periodNetPaidAmount!: string;
  @ApiProperty() currentOutstandingAmount!: string;
}
export class BalanceResponse {
  @ApiProperty() employeeId!: string;
  @ApiProperty() employeeName!: string;
  @ApiProperty({ type: String, nullable: true }) employeeCode!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() caseCount!: string;
  @ApiProperty() allocationCount!: string;
  @ApiProperty() assessedAmount!: string;
  @ApiProperty() netPaidAmount!: string;
  @ApiProperty() outstandingAmount!: string;
}
export class CaseReportResponse {
  @ApiProperty() id!: string;
  @ApiProperty() caseCode!: string;
  @ApiProperty() caseNumber!: number;
  @ApiProperty({ enum: ['DRAFT', 'POSTED', 'VOIDED'] }) status!:
    'DRAFT' | 'POSTED' | 'VOIDED';
  @ApiProperty({ type: String, nullable: true }) occurredAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, nullable: true }) violationName!: string | null;
  @ApiProperty() allocationCount!: string;
  @ApiProperty() unknownAmountCount!: string;
  @ApiProperty() previewAmount!: string;
  @ApiProperty() assessedAmount!: string;
  @ApiProperty() netPaidAmount!: string;
  @ApiProperty() outstandingAmount!: string;
}
export class SummaryEnvelope {
  @ApiProperty({ type: ReportSummaryResponse }) data!: ReportSummaryResponse;
}
export class BalanceEnvelope {
  @ApiProperty({ type: [BalanceResponse] }) data!: BalanceResponse[];
  @ApiProperty({ type: PageMetaResponse }) meta!: PageMetaResponse;
}
export class CaseReportEnvelope {
  @ApiProperty({ type: [CaseReportResponse] }) data!: CaseReportResponse[];
  @ApiProperty({ type: PageMetaResponse }) meta!: PageMetaResponse;
}
export class DashboardResponse {
  @ApiProperty({ type: ReportSummaryResponse }) summary!: ReportSummaryResponse;
  @ApiProperty({ type: [CaseReportResponse] })
  recentCases!: CaseReportResponse[];
  @ApiProperty({ type: [CaseReportResponse] }) drafts!: CaseReportResponse[];
  @ApiProperty() draftCount!: string;
  @ApiProperty({ type: [BalanceResponse] }) topOutstanding!: BalanceResponse[];
}
export class DashboardEnvelope {
  @ApiProperty({ type: DashboardResponse }) data!: DashboardResponse;
}
export class SettingsResponse {
  @ApiProperty() businessName!: string;
  @ApiProperty({ type: String, nullable: true }) finePolicyReference!:
    string | null;
  @ApiProperty() version!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ type: String, nullable: true }) updatedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) updatedBy!: string | null;
}
export class SettingsEnvelope {
  @ApiProperty({ type: SettingsResponse }) data!: SettingsResponse;
}
export class AuditResponse {
  @ApiProperty() id!: string;
  @ApiProperty() actorUserId!: string;
  @ApiProperty() actorName!: string;
  @ApiProperty() action!: string;
  @ApiProperty() entityType!: string;
  @ApiProperty() entityId!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) requestId!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  beforeJson!: Record<string, unknown> | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  afterJson!: Record<string, unknown> | null;
}
export class AuditEnvelope {
  @ApiProperty({ type: [AuditResponse] }) data!: AuditResponse[];
  @ApiProperty({ type: PageMetaResponse }) meta!: PageMetaResponse;
}
export class ActorResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}
export class AuditOptionsResponse {
  @ApiProperty({ type: [ActorResponse] }) actors!: ActorResponse[];
  @ApiProperty({ type: [String] }) actions!: string[];
  @ApiProperty({ type: [String] }) entityTypes!: string[];
}
export class AuditOptionsEnvelope {
  @ApiProperty({ type: AuditOptionsResponse }) data!: AuditOptionsResponse;
}
