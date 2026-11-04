import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CommunicationModule } from '../communication/communication.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { R2Service } from './r2.service';

@Module({
  imports: [PrismaModule, CommunicationModule],
  controllers: [UserController],
  providers: [UserService, R2Service],
  exports: [UserService, R2Service],
})
export class UserModule {}
