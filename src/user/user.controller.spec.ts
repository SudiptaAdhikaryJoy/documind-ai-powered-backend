import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { JwtUserPayload } from '../auth/jwt.strategy';

describe('UserController', () => {
  let controller: UserController;
  let userService: {
    getProfile: jest.Mock;
    updateProfile: jest.Mock;
    updatePassword: jest.Mock;
    createAvatarUploadUrl: jest.Mock;
    confirmAvatar: jest.Mock;
    deleteAvatar: jest.Mock;
    handleR2Webhook: jest.Mock;
    requestEmailVerification: jest.Mock;
    requestPhoneVerification: jest.Mock;
  };

  const mockUser: JwtUserPayload = {
    userId: 'user-123',
    email: 'jane@acme.com',
  };

  beforeEach(async () => {
    userService = {
      getProfile: jest.fn().mockResolvedValue({ statusCode: 200, data: {} }),
      updateProfile: jest.fn().mockResolvedValue({ statusCode: 200, data: {} }),
      updatePassword: jest.fn().mockResolvedValue({ statusCode: 200, message: 'Password updated' }),
      createAvatarUploadUrl: jest.fn().mockResolvedValue({ statusCode: 200, data: {} }),
      confirmAvatar: jest.fn().mockResolvedValue({ statusCode: 200, data: {} }),
      deleteAvatar: jest.fn().mockResolvedValue({ statusCode: 200, message: 'Deleted' }),
      handleR2Webhook: jest.fn().mockResolvedValue({ statusCode: 200, message: 'Processed' }),
      requestEmailVerification: jest.fn().mockResolvedValue({ statusCode: 200, message: 'Sent' }),
      requestPhoneVerification: jest.fn().mockResolvedValue({ statusCode: 200, message: 'Sent' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: userService }],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getProfile should invoke userService.getProfile', async () => {
    await controller.getProfile(mockUser);
    expect(userService.getProfile).toHaveBeenCalledWith('user-123');
  });

  it('getMe should invoke userService.getProfile', async () => {
    await controller.getMe(mockUser);
    expect(userService.getProfile).toHaveBeenCalledWith('user-123');
  });

  it('updateProfile should invoke userService.updateProfile', async () => {
    const dto = { name: 'Jane Updated' };
    await controller.updateProfile(mockUser, dto);
    expect(userService.updateProfile).toHaveBeenCalledWith('user-123', dto);
  });

  it('updatePassword should invoke userService.updatePassword', async () => {
    const dto = { currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' };
    await controller.updatePassword(mockUser, dto);
    expect(userService.updatePassword).toHaveBeenCalledWith('user-123', dto);
  });

  it('createAvatarUploadUrl should invoke userService.createAvatarUploadUrl', async () => {
    const dto = { filename: 'avatar.png' };
    await controller.createAvatarUploadUrl(mockUser, dto);
    expect(userService.createAvatarUploadUrl).toHaveBeenCalledWith('user-123', dto);
  });

  it('confirmAvatar should invoke userService.confirmAvatar', async () => {
    const dto = { avatarUrl: 'https://cdn.test/avatar.jpg' };
    await controller.confirmAvatar(mockUser, dto);
    expect(userService.confirmAvatar).toHaveBeenCalledWith('user-123', dto);
  });

  it('deleteAvatar should invoke userService.deleteAvatar', async () => {
    await controller.deleteAvatar(mockUser);
    expect(userService.deleteAvatar).toHaveBeenCalledWith('user-123');
  });

  it('handleWebhook should invoke userService.handleR2Webhook', async () => {
    const payload = { action: 'PutObject' };
    await controller.handleWebhook(payload, 'secret');
    expect(userService.handleR2Webhook).toHaveBeenCalledWith(payload, 'secret');
  });

  it('requestEmailVerification should invoke userService.requestEmailVerification', async () => {
    await controller.requestEmailVerification(mockUser);
    expect(userService.requestEmailVerification).toHaveBeenCalledWith('user-123');
  });

  it('requestPhoneVerification should invoke userService.requestPhoneVerification', async () => {
    await controller.requestPhoneVerification(mockUser);
    expect(userService.requestPhoneVerification).toHaveBeenCalledWith('user-123');
  });
});
