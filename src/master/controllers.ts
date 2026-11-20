import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthRequest } from '../auth/auth.js';
import {
  AliasDto,
  EmployeeCreateDto,
  EmployeeUpdateDto,
  EmptyDto,
  MasterQuery,
  ViolationCreateDto,
  ViolationQuery,
  ViolationUpdateDto,
} from './dto.js';
import { EmployeesService } from './employees.service.js';
import { ViolationsService } from './violations.service.js';
import {
  AliasEnvelope,
  EmployeeEnvelope,
  EmployeesEnvelope,
  SuccessEnvelope,
  ViolationEnvelope,
  ViolationsEnvelope,
} from './responses.js';
const actor = (req: AuthRequest) => ({
  userId: req.session!.userId,
  requestId: req.requestId,
});
const uuid = new ParseUUIDPipe();
@ApiTags('employees')
@ApiCookieAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private employees: EmployeesService) {}
  @Get() @ApiOkResponse({ type: EmployeesEnvelope }) list(
    @Query() query: MasterQuery,
  ) {
    return this.employees.list(query);
  }
  @Get(':id') @ApiOkResponse({ type: EmployeeEnvelope }) get(
    @Param('id', uuid) id: string,
  ) {
    return this.employees.get(id);
  }
  @Post()
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCreatedResponse({ type: EmployeeEnvelope })
  create(@Body() body: EmployeeCreateDto, @Req() req: AuthRequest) {
    return this.employees.create(body, actor(req));
  }
  @Patch(':id')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: EmployeeEnvelope })
  update(
    @Param('id', uuid) id: string,
    @Body() body: EmployeeUpdateDto,
    @Req() req: AuthRequest,
  ) {
    return this.employees.update(id, body, actor(req));
  }
  @Post(':id/archive')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCreatedResponse({ type: EmployeeEnvelope })
  archive(
    @Param('id', uuid) id: string,
    @Body() _body: EmptyDto,
    @Req() req: AuthRequest,
  ) {
    return this.employees.setActive(id, false, actor(req));
  }
  @Post(':id/restore')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCreatedResponse({ type: EmployeeEnvelope })
  restore(
    @Param('id', uuid) id: string,
    @Body() _body: EmptyDto,
    @Req() req: AuthRequest,
  ) {
    return this.employees.setActive(id, true, actor(req));
  }
  @Post(':id/aliases')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCreatedResponse({ type: AliasEnvelope })
  addAlias(
    @Param('id', uuid) id: string,
    @Body() body: AliasDto,
    @Req() req: AuthRequest,
  ) {
    return this.employees.addAlias(id, body.aliasDisplay, actor(req));
  }
  @Delete(':id/aliases/:aliasId')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: SuccessEnvelope })
  removeAlias(
    @Param('id', uuid) id: string,
    @Param('aliasId', uuid) aliasId: string,
    @Req() req: AuthRequest,
  ) {
    return this.employees.removeAlias(id, aliasId, actor(req));
  }
}
@ApiTags('violation-types')
@ApiCookieAuth()
@Controller('violation-types')
export class ViolationsController {
  constructor(private violations: ViolationsService) {}
  @Get() @ApiOkResponse({ type: ViolationsEnvelope }) list(
    @Query() query: ViolationQuery,
  ) {
    return this.violations.list(query);
  }
  @Get(':id') @ApiOkResponse({ type: ViolationEnvelope }) get(
    @Param('id', uuid) id: string,
  ) {
    return this.violations.get(id);
  }
  @Post()
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCreatedResponse({ type: ViolationEnvelope })
  create(@Body() body: ViolationCreateDto, @Req() req: AuthRequest) {
    return this.violations.create(body, actor(req));
  }
  @Patch(':id')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: ViolationEnvelope })
  update(
    @Param('id', uuid) id: string,
    @Body() body: ViolationUpdateDto,
    @Req() req: AuthRequest,
  ) {
    return this.violations.update(id, body, actor(req));
  }
  @Post(':id/archive')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCreatedResponse({ type: ViolationEnvelope })
  archive(
    @Param('id', uuid) id: string,
    @Body() _body: EmptyDto,
    @Req() req: AuthRequest,
  ) {
    return this.violations.setActive(id, false, actor(req));
  }
  @Post(':id/restore')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCreatedResponse({ type: ViolationEnvelope })
  restore(
    @Param('id', uuid) id: string,
    @Body() _body: EmptyDto,
    @Req() req: AuthRequest,
  ) {
    return this.violations.setActive(id, true, actor(req));
  }
}
