import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { LlmService } from './llm.service';

describe('LlmService', () => {
  let service: LlmService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              const env: Record<string, string> = {
                LLM_BASE_URL: 'https://api.groq.com/openai/v1',
                LLM_API_KEY: 'test-api-key',
                LLM_MODEL: 'qwen/qwen3.8-27b',
                LLM_TEMPERATURE: '0',
                LLM_THINK: 'false',
                MAX_OUTPUT_TOKENS: '250',
                LLM_TIMEOUT_MS: '5000',
              };
              return env[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LlmService>(LlmService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends OpenAI-compatible chat completion payload with deterministic settings', async () => {
    const mockResponseBody = {
      choices: [
        {
          message: {
            content: 'Refunds must be authorized by an admin [e1].',
          },
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 15,
      },
      model: 'qwen/qwen3.8-27b',
    };

    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce(mockResponseBody),
    } as any);

    const result = await service.complete({
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'What is the refund rule?' },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');

    const headers = requestInit?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-api-key');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(requestInit?.body as string);
    expect(body.model).toBe('qwen/qwen3.8-27b');
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(250);
    expect(body.think).toBe(false);

    expect(result.content).toBe('Refunds must be authorized by an admin [e1].');
    expect(result.promptTokens).toBe(120);
    expect(result.outputTokens).toBe(15);
    expect(result.model).toBe('qwen/qwen3.8-27b');
  });

  it('supports dynamic parameter overrides (model, temperature, maxTokens)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        choices: [{ message: { content: 'Custom response' } }],
      }),
    } as any);

    await service.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      options: {
        model: 'deepseek-v3',
        temperature: 0.2,
        maxTokens: 100,
        baseUrl: 'http://localhost:11434/v1',
      },
    });

    const [url, requestInit] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse(requestInit?.body as string);
    expect(body.model).toBe('deepseek-v3');
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(100);
  });

  it('throws BadGatewayException when provider returns non-200 HTTP code', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: jest.fn().mockResolvedValueOnce('Rate limit exceeded'),
    } as any);

    await expect(
      service.complete({
        messages: [{ role: 'user', content: 'Test' }],
      }),
    ).rejects.toThrow(BadGatewayException);
  });
});
