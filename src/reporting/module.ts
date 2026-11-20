import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthRequest } from '../auth/auth.js';
import { ReportsService } from './reports.service.js';
import { SettingsService } from './settings.service.js';
import { AuditReadService } from './audit.service.js';
import {
  ReportQuery,
  BalanceQuery,
  CaseReportQuery,
  PaymentExportQuery,
  AuditQuery,
  SettingsDto,
} from './dto.js';
import {
  SummaryEnvelope,
  BalanceEnvelope,
  CaseReportEnvelope,
  DashboardEnvelope,
  SettingsEnvelope,
  AuditEnvelope,
  AuditOptionsEnvelope,
} from './responses.js';
const actor = (r: AuthRequest) => ({
  userId: r.session!.userId,
  requestId: r.requestId,
});
@ApiCookieAuth()
@ApiTags('reports')
@Controller('reports')
class ReportsController {
  constructor(private reports: ReportsService) {}
  @Get('summary') @ApiOkResponse({ type: SummaryEnvelope }) summary(
    @Query() q: ReportQuery,
  ) {
    return this.reports.summary(q);
  }
  @Get('employee-balances') @ApiOkResponse({ type: BalanceEnvelope }) balances(
    @Query() q: BalanceQuery,
  ) {
    return this.reports.balances(q);
  }
  @Get('fine-cases') @ApiOkResponse({ type: CaseReportEnvelope }) cases(
    @Query() q: CaseReportQuery,
  ) {
    return this.reports.cases(q);
  }
  @Get('fine-cases.csv')
  @ApiProduces('text/csv')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  exportCases(@Query() q: CaseReportQuery, @Req() r: AuthRequest) {
    return this.reports.exportCases(q, actor(r));
  }
  @Get('payments.csv')
  @ApiProduces('text/csv')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  exportPayments(@Query() q: PaymentExportQuery, @Req() r: AuthRequest) {
    return this.reports.exportPayments(q, actor(r));
  }
}
@ApiCookieAuth()
@ApiTags('dashboard')
@Controller('dashboard')
class DashboardController {
  constructor(private reports: ReportsService) {}
  @Get('summary') @ApiOkResponse({ type: DashboardEnvelope }) summary(
    @Query() q: ReportQuery,
  ) {
    return this.reports.dashboard(q);
  }
}
@ApiCookieAuth()
@ApiTags('employees')
@Controller('employees')
class EmployeeSummaryController {
  constructor(private reports: ReportsService) {}
  @Get(':id/summary') @ApiOkResponse({ type: SummaryEnvelope }) summary(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: ReportQuery,
  ) {
    return this.reports.employee(id, q);
  }
}
@ApiCookieAuth()
@ApiTags('settings')
@Controller('settings')
class SettingsController {
  constructor(private settings: SettingsService) {}
  @Get() @ApiOkResponse({ type: SettingsEnvelope }) get() {
    return this.settings.read();
  }
  @Patch()
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: SettingsEnvelope })
  update(@Body() b: SettingsDto, @Req() r: AuthRequest) {
    return this.settings.update(b, actor(r));
  }
}
@ApiCookieAuth()
@ApiTags('audit')
@Controller('audit-logs')
class AuditController {
  constructor(private audit: AuditReadService) {}
  @Get() @ApiOkResponse({ type: AuditEnvelope }) list(@Query() q: AuditQuery) {
    return this.audit.list(q);
  }
  @Get('options') @ApiOkResponse({ type: AuditOptionsEnvelope }) options() {
    return this.audit.options();
  }
}
@Module({
  controllers: [
    ReportsController,
    DashboardController,
    EmployeeSummaryController,
    SettingsController,
    AuditController,
  ],
  providers: [ReportsService, SettingsService, AuditReadService],
})
export class ReportingModule {}
