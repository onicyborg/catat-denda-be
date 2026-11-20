import { ApiProperty } from '@nestjs/swagger';
export class PageMetaResponse {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}
export class PageResult<T> {
  constructor(
    public data: T[],
    public meta: PageMetaResponse,
  ) {}
}
