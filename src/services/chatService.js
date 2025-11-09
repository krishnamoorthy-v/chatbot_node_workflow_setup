import { getEnv } from "./config/env.js";
import openai from "../config/openaiClient.js";

const defaultModel = getEnv("OPENAI_MODEL", "gpt-4o-mini");

export async function streamChatCompletion({
  messages,
  onToken,
  onComplete,
  onError,
}) {
  try {
    const stream = await openai.chat.completions.create({
      model: defaultModel,
      messages,
      stream: true,
    });

    let fullText = "";

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (!delta) {
        continue;
      }
      fullText += delta;
      onToken?.(delta);
    }

    onComplete?.(fullText);
    return fullText;
  } catch (error) {
    onError?.(error);
    throw error;
  }
}
