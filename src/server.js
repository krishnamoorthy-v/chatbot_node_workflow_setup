import express from "express";
import http from "http";
import { Server } from "socket.io";
import { assertEnv, getEnv } from "./config/env.js";
import openai from "./config/openaiClient.js";
import { ChatSession } from "./services/sessionStore.js";
import { execute } from "./utils/Execution.js";

const defaultModel = getEnv("OPENAI_MODEL", "gpt-4o-mini");

assertEnv();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: getEnv("CORS_ORIGIN", "*"),
  },
});

const port = Number.parseInt(getEnv("PORT", "3000"), 10);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Store conversation history per socket
const userSessions = new Map();
const userSockets = new Map();

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);
  // console.dir({ socket }, { depth: null });

  socket.on("authenticate", (userId) => {
    console.log(`Authenticating user ${userId}`);
    userSockets.set(userId, socket.id);
    socket.userId = userId;

    //join a room named after their userId
    socket.join(userId);

    //Initialize session or retrive existing session

    if (!userSessions.has(userId)) {
      const session = new ChatSession({
        initialMessages: [
          {
            role: "system",
            content: "You are a helpful AI assistant.",
            date: new Date().toISOString(),
          },
        ],
        initialVariables: {
          userId,
          currentNode: "start",
          promptInitiated: false,
          connectedAt: new Date().toISOString(),
        },
      });

      userSessions.set(userId, session);
      console.log(`New session created for user ${userId}`);
    }

    const session = userSessions.get(userId);
    session.setVariable("lastConnected", new Date().toISOString());

    // Handle user message
    socket.on("message-user", async (message) => {
      session.addMessage({
        role: "user",
        content: message,
        date: new Date().toISOString(),
      });
      // const messages = session.getMessages().map(({ role, content }) => ({
      //   role,
      //   content,
      // }));

      await execute.nodes?.[session?.getVariable("currentNode")]?.task({
        session,
        socket,
        openai,
        defaultModel,
      });

      // try {
      //   const stream = await openai.chat.completions.create({
      //     model: defaultModel,
      //     messages,
      //     stream: true,
      //   });

      //   // Start AI message
      //   const aiMessage = {
      //     role: "assistant",
      //     content: "",
      //     date: new Date().toISOString(),
      //   };

      //   for await (const chunk of stream) {
      //     const delta = chunk.choices?.[0]?.delta?.content || "";
      //     if (delta) {
      //       aiMessage.content += delta;
      //       socket.emit("ai-message-stream", delta); // send streaming updates
      //     }
      //   }

      //   // Send final AI message
      //   socket.emit("ai-message", aiMessage);

      //   // Save full conversation
      //   session.addMessage(aiMessage);

      //   // Update message count
      //   const messageCount = session.getVariable("messageCount", 0);
      //   session.setVariable("messageCount", messageCount + 2); // user + ai

      //   // console.dir({ userSessions }, { depth: null });
      // } catch (error) {
      //   console.error("Error during AI response:", error);
      //   socket.emit("error", { message: "AI response failed" });
      // }
    });
  });

  socket.on("disconnect", (reason) => {
    console.log(`Client disconnected: ${socket.id} (${reason})`);
    userSockets.delete(socket.userId);
    userSessions.delete(socket.id);
  });
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
