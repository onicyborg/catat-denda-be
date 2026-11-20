import { ApiProperty } from '@nestjs/swagger';
import { PageMetaResponse } from '../pagination.js';
import { Category } from '../generated/prisma/client.js';
export class AliasResponse {
  @ApiProperty() id!: string;
  @ApiProperty() aliasDisplay!: string;
}
export class EmployeeResponse {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true }) employeeCode!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({ type: String, nullable: true }) archivedAt!: string | null;
  @ApiProperty({ type: [AliasResponse] }) aliases!: AliasResponse[];
}
export class ViolationResponse {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: Category }) category!: Category;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty() defaultAmountPerPerson!: number;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
export class EmployeeEnvelope {
  @ApiProperty({ type: EmployeeResponse }) data!: EmployeeResponse;
}
export class EmployeesEnvelope {
  @ApiProperty({ type: [EmployeeResponse] }) data!: EmployeeResponse[];
  @ApiProperty({ type: PageMetaResponse }) meta!: PageMetaResponse;
}
export class ViolationEnvelope {
  @ApiProperty({ type: ViolationResponse }) data!: ViolationResponse;
}
export class ViolationsEnvelope {
  @ApiProperty({ type: [ViolationResponse] }) data!: ViolationResponse[];
  @ApiProperty({ type: PageMetaResponse }) meta!: PageMetaResponse;
}
export class AliasEnvelope {
  @ApiProperty({ type: AliasResponse }) data!: AliasResponse;
}
export class SuccessEnvelope {
  @ApiProperty() data!: { success: boolean };
}
