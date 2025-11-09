import OpenAI from "openai";
import { assertEnv, getEnv } from "./env.js";

assertEnv();

const client = new OpenAI({
  apiKey: getEnv("OPENAI_API_KEY"),
});

export default client;
