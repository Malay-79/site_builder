import OpenAI from 'openai';
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.AI_API_KEY || '',
    timeout: 120 * 1000, // 120 seconds max for API calls
    maxRetries: 1, // Retry once on failure
});
export default openai;
