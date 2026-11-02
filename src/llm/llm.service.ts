import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LlmCompletionOptions,
  LlmCompletionRequest,
  LlmCompletionResponse,
} from './llm.types';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Dispatches a chat completion to an OpenAI-compatible endpoint.
   *
   * Fully dynamic:
   * Resolves baseUrl, apiKey, model, temperature, think, maxTokens, and timeout
   * per invocation from ConfigService or request options.
   */
  async complete(
    request: LlmCompletionRequest,
  ): Promise<LlmCompletionResponse> {
    const opts = request.options;

    const baseUrl = (
      opts?.baseUrl ??
      this.config.get<string>('LLM_BASE_URL', 'https://api.groq.com/openai/v1')
    ).replace(/\/+$/, '');

    const apiKey = opts?.apiKey ?? this.config.get<string>('LLM_API_KEY');

    const model =
      opts?.model ??
      this.config.get<string>('LLM_MODEL', 'qwen/qwen3.8-27b');

    const temperature =
      opts?.temperature ??
      parseFloat(this.config.get<string>('LLM_TEMPERATURE', '0'));

    const maxTokens =
      opts?.maxTokens ??
      parseInt(this.config.get<string>('MAX_OUTPUT_TOKENS', '250'), 10);

    const think =
      opts?.think ??
      (this.config.get<string>('LLM_THINK', 'false') === 'true');

    const timeoutMs =
      opts?.timeoutMs ??
      parseInt(this.config.get<string>('LLM_TIMEOUT_MS', '120000'), 10);

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    const endpoint = `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const payload: Record<string, any> = {
      model,
      messages: request.messages,
      temperature,
      max_tokens: maxTokens,
    };

    // Explicitly pass think: false to supported reasoning/hybrid models (e.g. Qwen, DeepSeek)
    if (think === false) {
      payload.think = false;
      // Some OpenAI-compatible gateways expect chat_template_kwargs or extra_body
      payload.chat_template_kwargs = { think: false };
    }

    const startTime = Date.now();

    try {
      this.logger.debug(
        `Sending LLM completion request to ${endpoint} (model: ${model}, max_tokens: ${maxTokens})`,
      );

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        this.logger.error(
          `LLM provider returned HTTP ${res.status}: ${errorText}`,
        );
        throw new BadGatewayException(
          `LLM provider error (${res.status}): ${errorText.slice(0, 300)}`,
        );
      }

      const json = (await res.json()) as any;
      const choice = json.choices?.[0];
      const content: string = choice?.message?.content ?? '';

      const promptTokens =
        json.usage?.prompt_tokens ??
        Math.ceil(
          request.messages.reduce((sum, m) => sum + m.content.length, 0) / 4,
        );

      const outputTokens =
        json.usage?.completion_tokens ?? Math.ceil(content.length / 4);

      return {
        content: content.trim(),
        promptTokens,
        outputTokens,
        latencyMs,
        model: json.model ?? model,
      };
    } catch (err: unknown) {
      if (err instanceof BadGatewayException) {
        throw err;
      }

      const isAbort =
        (err as any)?.name === 'AbortError' ||
        controller.signal.aborted;

      if (isAbort) {
        this.logger.error(`LLM request timed out after ${timeoutMs}ms`);
        throw new GatewayTimeoutException(
          `LLM request timed out after ${timeoutMs}ms`,
        );
      }

      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to connect to LLM provider: ${msg}`);
      throw new BadGatewayException(
        `Unable to reach LLM provider at ${baseUrl}: ${msg}`,
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
