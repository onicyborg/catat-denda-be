import { ApiProperty } from '@nestjs/swagger';
import { CaseStatus } from '../generated/prisma/client.js';
import { FineLedgerResponse } from '../fines/responses.js';
import { PageMetaResponse } from '../pagination.js';
export class PaymentResponse extends FineLedgerResponse {
  @ApiProperty() signedAmount!: string;
  @ApiProperty() recordedByName!: string;
  @ApiProperty() caseId!: string;
  @ApiProperty() caseCode!: string;
  @ApiProperty({ enum: CaseStatus }) caseStatus!: CaseStatus;
  @ApiProperty() memberId!: string;
  @ApiProperty({ type: String, nullable: true }) employeeId!: string | null;
  @ApiProperty() employeeName!: string;
  @ApiProperty({ type: String, nullable: true }) reversalId!: string | null;
  @ApiProperty() canReverse!: boolean;
}
export class PaymentEnvelope {
  @ApiProperty({ type: PaymentResponse }) data!: PaymentResponse;
}
export class PaymentsEnvelope {
  @ApiProperty({ type: [PaymentResponse] }) data!: PaymentResponse[];
  @ApiProperty({ type: PageMetaResponse }) meta!: PageMetaResponse;
}
