import {
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Param,
  ParseUUIDPipe,
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
import { PaymentDto, PaymentQuery, ReverseDto } from './dto.js';
import { PaymentEnvelope, PaymentsEnvelope } from './responses.js';
import { PaymentsService } from './service.js';
const uuid = new ParseUUIDPipe();
const actor = (req: AuthRequest) => ({
  userId: req.session!.userId,
  requestId: req.requestId,
});
@ApiTags('payments')
@ApiCookieAuth()
@Controller('payments')
class PaymentsController {
  constructor(private payments: PaymentsService) {}
  @Get() @ApiOkResponse({ type: PaymentsEnvelope }) list(
    @Query() q: PaymentQuery,
  ) {
    return this.payments.list(q);
  }
  @Get(':id') @ApiOkResponse({ type: PaymentEnvelope }) get(
    @Param('id', uuid) id: string,
  ) {
    return this.payments.get(id);
  }
  @Post(':id/reverse')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: PaymentEnvelope })
  reverse(
    @Param('id', uuid) id: string,
    @Body() b: ReverseDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthRequest,
  ) {
    return this.payments.reverse(id, b, key, actor(req));
  }
}
@ApiTags('payments')
@ApiCookieAuth()
@Controller('fine-members')
class MemberPaymentsController {
  constructor(private payments: PaymentsService) {}
  @Post(':id/payments')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: PaymentEnvelope })
  pay(
    @Param('id', uuid) id: string,
    @Body() b: PaymentDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthRequest,
  ) {
    return this.payments.pay(id, b, key, actor(req));
  }
}
@Module({
  controllers: [PaymentsController, MemberPaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
