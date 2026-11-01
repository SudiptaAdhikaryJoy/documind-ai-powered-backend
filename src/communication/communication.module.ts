import { Global, Module } from '@nestjs/common';
import { MailService } from './mail/mail.service';
import { SmsService } from './sms/sms.service';
import { OtpService } from './otp/otp.service';
import { NotificationService } from './notification/notification.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [MailService, SmsService, OtpService, NotificationService],
  exports: [MailService, SmsService, OtpService, NotificationService],
})
export class CommunicationModule {}
