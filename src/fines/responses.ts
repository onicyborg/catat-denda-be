import { ApiProperty } from '@nestjs/swagger';
import { CaseStatus, EntryKind, Method } from '../generated/prisma/client.js';
import { ViolationResponse } from '../master/responses.js';
import { PageMetaResponse } from '../pagination.js';
export class FineLedgerResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: EntryKind }) kind!: EntryKind;
  @ApiProperty() amount!: number;
  @ApiProperty({ enum: Method, nullable: true }) method!: Method | null;
  @ApiProperty() effectiveAt!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() recordedBy!: string;
  @ApiProperty({ type: String, nullable: true }) originalPaymentId!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
}
export class FineMemberResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, nullable: true }) employeeId!: string | null;
  @ApiProperty({ type: String, nullable: true }) employeeNameSnapshot!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) rawEmployeeName!:
    string | null;
  @ApiProperty() employeeDisplayName!: string;
  @ApiProperty({ type: Boolean, nullable: true }) employeeIsActive!:
    boolean | null;
  @ApiProperty({ type: Number, nullable: true }) assignedAmount!: number | null;
  @ApiProperty() netPaidAmount!: string;
  @ApiProperty() outstandingAmount!: string;
  @ApiProperty({
    type: String,
    enum: ['UNPAID', 'PARTIAL', 'PAID'],
    nullable: true,
  })
  settlementStatus!: string | null;
  @ApiProperty({ type: [FineLedgerResponse] }) entries!: FineLedgerResponse[];
}
export class FineResponse {
  @ApiProperty() id!: string;
  @ApiProperty() caseNumber!: number;
  @ApiProperty() displayCode!: string;
  @ApiProperty({ enum: CaseStatus }) status!: CaseStatus;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, nullable: true }) occurredAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) violationTypeId!:
    string | null;
  @ApiProperty({ type: ViolationResponse, nullable: true })
  violationType!: ViolationResponse | null;
  @ApiProperty({ type: String, nullable: true }) violationCodeSnapshot!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) violationNameSnapshot!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) violationCategorySnapshot!:
    string | null;
  @ApiProperty({ type: Number, nullable: true }) defaultRateSnapshot!:
    number | null;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, nullable: true }) sourceText!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiProperty() createdBy!: string;
  @ApiProperty({ type: String, nullable: true }) postedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) postedBy!: string | null;
  @ApiProperty({ type: String, nullable: true }) voidedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) voidedBy!: string | null;
  @ApiProperty({ type: String, nullable: true }) voidReason!: string | null;
  @ApiProperty() currency!: string;
  @ApiProperty() previewAmount!: string;
  @ApiProperty() amountsComplete!: boolean;
  @ApiProperty() assessedAmount!: string;
  @ApiProperty() netPaidAmount!: string;
  @ApiProperty() outstandingAmount!: string;
  @ApiProperty({
    type: String,
    enum: ['UNPAID', 'PARTIAL', 'PAID'],
    nullable: true,
  })
  settlementStatus!: string | null;
  @ApiProperty() hasLedgerHistory!: boolean;
  @ApiProperty() canEditFinancial!: boolean;
  @ApiProperty() canVoid!: boolean;
  @ApiProperty({ type: [FineMemberResponse] }) members!: FineMemberResponse[];
}
export class FineEnvelope {
  @ApiProperty({ type: FineResponse }) data!: FineResponse;
}
export class FinePageEnvelope {
  @ApiProperty({ type: [FineResponse] }) data!: FineResponse[];
  @ApiProperty({ type: PageMetaResponse }) meta!: PageMetaResponse;
}
