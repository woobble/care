import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CalendarSubscriptionStatusResponseDto {
  @ApiProperty()
  active!: boolean;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  createdAt!: string | null;
}

export class CalendarSubscriptionCreatedResponseDto {
  @ApiProperty({ example: true })
  active!: true;

  @ApiProperty({ format: 'uri', description: 'HTTPS subscription URL. Shown once.' })
  httpsUrl!: string;

  @ApiProperty({ format: 'uri', description: 'webcal URL for compatible calendar applications.' })
  webcalUrl!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CalendarSubscriptionRevokedResponseDto {
  @ApiProperty({ description: 'Whether an active subscription was revoked.' })
  revoked!: boolean;
}
