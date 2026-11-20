import {
  Module,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  ParseUUIDPipe,
  Body,
  Query,
  Req,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import type { AuthRequest } from '../auth/auth.js';
import { FinesService } from './service.js';
import {
  FineCreateDto,
  FineUpdateDto,
  FineQuery,
  FineVersionDto,
  FineVoidDto,
} from './dto.js';
import { FineEnvelope, FinePageEnvelope } from './responses.js';
const actor = (r: AuthRequest) => ({
  userId: r.session!.userId,
  requestId: r.requestId,
});
const uuid = new ParseUUIDPipe();
@ApiTags('fine-cases')
@ApiCookieAuth()
@Controller('fine-cases')
class FinesController {
  constructor(private fines: FinesService) {}
  @Get() @ApiOkResponse({ type: FinePageEnvelope }) list(
    @Query() q: FineQuery,
  ) {
    return this.fines.list(q);
  }
  @Get(':id') @ApiOkResponse({ type: FineEnvelope }) get(
    @Param('id', uuid) id: string,
  ) {
    return this.fines.get(id);
  }
  @Post()
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: FineEnvelope })
  create(
    @Body() b: FineCreateDto,
    @Headers('idempotency-key') key: string,
    @Req() r: AuthRequest,
  ) {
    return this.fines.create(b, key, actor(r));
  }
  @Patch(':id')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: FineEnvelope })
  update(
    @Param('id', uuid) id: string,
    @Body() b: FineUpdateDto,
    @Req() r: AuthRequest,
  ) {
    return this.fines.update(id, b, actor(r));
  }
  @Post(':id/post')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCreatedResponse({ type: FineEnvelope })
  post(
    @Param('id', uuid) id: string,
    @Body() b: FineVersionDto,
    @Req() r: AuthRequest,
  ) {
    return this.fines.post(id, b.version, actor(r));
  }
  @Post(':id/void')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCreatedResponse({ type: FineEnvelope })
  void(
    @Param('id', uuid) id: string,
    @Body() b: FineVoidDto,
    @Req() r: AuthRequest,
  ) {
    return this.fines.void(id, b.version, b.reason, actor(r));
  }
}
@Module({ controllers: [FinesController], providers: [FinesService] })
export class FinesModule {}
