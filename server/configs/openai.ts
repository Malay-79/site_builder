import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.AI_API_KEY || '',
  timeout: 120 * 1000, // 120 seconds max for API calls
  maxRetries: 1,       // Retry once on failure
});

export interface ChatCompletionParams {
  model: string;
  messages: any[];
  max_tokens: number;
}

export const createChatCompletionWithRetry = async (
  params: ChatCompletionParams,
  retryCount = 0
): Promise<any> => {
  const { model, messages, max_tokens } = params;
  try {
    console.log(`[OpenAI Wrapper] Requesting chat completion. Model: ${model}, max_tokens: ${max_tokens}`);
    const response = await openai.chat.completions.create({
      model,
      max_tokens,
      messages
    });
    return response;
  } catch (error: any) {
    const errorMessage = error?.message || "";
    const is402 = error?.status === 402 || errorMessage.includes("402") || errorMessage.toLowerCase().includes("credits") || errorMessage.toLowerCase().includes("max_tokens");
    
    console.warn(`[OpenAI Wrapper] Error encountered (Attempt ${retryCount + 1}):`, error.message || error);

    if (is402 && retryCount < 2) {
      // Try to parse the affordable tokens from OpenRouter error message
      // Example: "You requested up to 8192 tokens, but can only afford 8012."
      const match = errorMessage.match(/can only afford (\d+)/i);
      let nextMaxTokens = Math.floor(max_tokens * 0.6); // Default backoff: 60% of current limit
      
      if (match && match[1]) {
        const affordable = parseInt(match[1], 10);
        console.log(`[OpenAI Wrapper] OpenRouter reports user can only afford ${affordable} tokens.`);
        // Try a safe value slightly below what is affordable, but at least 1000 tokens
        nextMaxTokens = Math.max(1000, Math.floor(affordable * 0.95));
      }

      // Ensure it is strictly less than current max_tokens and doesn't fall below a hard minimum
      if (nextMaxTokens >= max_tokens) {
        nextMaxTokens = Math.max(1000, max_tokens - 500);
      }

      console.log(`[OpenAI Wrapper] Auto-retrying with lower max_tokens: ${nextMaxTokens}`);
      return createChatCompletionWithRetry({
        ...params,
        max_tokens: nextMaxTokens
      }, retryCount + 1);
    }

    // If it's a 402 and we exhausted retries, throw a user-friendly error
    if (is402) {
      throw new Error("Your OpenRouter API key has insufficient credits or requires a lower token limit. Please check your credit balance or upgrade at https://openrouter.ai/settings/credits");
    }

    throw error;
  }
};

export default openai;