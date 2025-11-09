import { tools } from "./Tools.js";

export const execute = {
  nodes: {
    // ========================================
    // NODE 1: Receptionist (Collect User Data)
    // ========================================
    start: {
      _id: "start",
      task: async ({ session, socket, openai, defaultModel }) => {
        console.log("Starting the workflow - Receptionist Node");

        try {
          console.log("currentNode: ", session.getVariable("currentNode"));
          if (session.getVariable("promptInitiated") == false) {
            session.addMessage({
              role: "system",
              content: `
              You are a Receptionist assistant. 
              Your task is to collect the following user details: username, age, email, phone number, role, and location.
              When all required details are collected, call the function 'save_user_data' with those values. 
              After saving, you MUST call 'complete_task' to determine the next step. 
              Do NOT summarize or explain—only ask for missing details until all are collected.
              `,
              date: new Date().toISOString(),
            });
            session.setVariable("promptInitiated", true);
          }

          const messages = session.getMessages().map(({ role, content }) => ({
            role,
            content,
          }));
        //   console.dir({ messages }, { depth: null });
          const stream = await openai.chat.completions.create({
            model: defaultModel,
            messages,
            stream: true,
            tools: [
              {
                type: "function",
                function: {
                  name: "save_user_data",
                  description:
                    "Save user's username, age, email, phone_number, role, location",
                  parameters: {
                    type: "object",
                    properties: {
                      username: { type: "string" },
                      age: { type: "integer" },
                      email: { type: "string" },
                      phone_number: { type: "string" },
                      role: { type: "string" },
                      location: { type: "string" },
                    },
                    required: [
                      "username",
                      "age",
                      "email",
                      "phone_number",
                      "role",
                      "location",
                    ],
                  },
                },
              },
              {
                type: "function",
                function: {
                  name: "complete_task",
                  description:
                    "Call this after save_user_data to determine next step based on user's intent",
                  parameters: {
                    type: "object",
                    properties: {
                      next_intent: {
                        type: "string",
                        enum: ["interview", "sales"],
                        description:
                          "Detected intent: 'interview' for job seekers, 'sales' for purchase inquiries",
                      },
                      reason: {
                        type: "string",
                        description: "Brief reason for routing decision",
                      },
                    },
                    required: ["next_intent", "reason"],
                  },
                },
              },
            ],
          });

          const aiMessage = {
            role: "assistant",
            content: "",
            date: new Date().toISOString(),
          };

          let toolCalls = [];
          let currentToolIndex = -1;

          for await (const chunk of stream) {
            const choice = chunk.choices?.[0];
            const delta = choice?.delta?.content || "";

            if (delta) {
              aiMessage.content += delta;
              socket.emit("ai-message-stream", delta);
            }

            // Handle tool calls
            if (choice?.delta?.tool_calls) {
              for (const toolCall of choice.delta.tool_calls) {
                const index = toolCall.index;

                if (index !== currentToolIndex) {
                  currentToolIndex = index;
                  toolCalls[index] = {
                    id: toolCall.id || "",
                    type: "function",
                    function: {
                      name: toolCall.function?.name || "",
                      arguments: toolCall.function?.arguments || "",
                    },
                  };
                } else if (toolCalls[index]) {
                  if (toolCall.function?.name) {
                    toolCalls[index].function.name += toolCall.function.name;
                  }
                  if (toolCall.function?.arguments) {
                    toolCalls[index].function.arguments +=
                      toolCall.function.arguments;
                  }
                }
              }
            }
          }

          // Process tool calls after stream completes
          let nextNode = null;

          for (const toolCall of toolCalls) {
            if (!toolCall?.function?.name) continue;

            try {
              const args = JSON.parse(toolCall.function.arguments);
              console.log(`Tool called: ${toolCall.function.name}`, args);

              if (toolCall.function.name === "save_user_data") {
                await tools.save_user_data(args);
                session.setVariable("userData", args);
                // session.addMessage({
                //   role: "assistant",
                //   content: JSON.stringify(args),
                //   date: new Date().toISOString(),
                // });
                socket.emit("user-data", args);
              }

              if (toolCall.function.name === "complete_task") {
                nextNode = args.next_intent;
                session.setVariable("routing_reason", args.reason);
                session.setVariable("currentNode", nextNode);
                console.log(`Routing to: ${nextNode} - Reason: ${args.reason}`);
                session.setVariable("promptInitiated", false);
              }
            } catch (e) {
              console.error(
                `Failed to parse tool call for ${toolCall.function.name}:`,
                e
              );
            }
          }

          socket.emit("ai-message", aiMessage);
          session.addMessage(aiMessage);

          const messageCount = session.getVariable("messageCount", 0);
          session.setVariable("messageCount", messageCount + 2);

          // Return next node for routing
          return { nextNode };
        } catch (error) {
          console.error("Error in receptionist node:", error);
          socket.emit("error", { message: "Receptionist node failed" });
          return { nextNode: null };
        }
      },
    },

    // ========================================
    // NODE 2: Interview Assistant
    // ========================================
    interview: {
      _id: "interview",
      task: async ({ session, socket, openai, defaultModel }) => {
        console.log("Interview Node - Starting interview process");

        try {
          const userData = session.getVariable("userData");

          if (session.getVariable("promptInitiated") == false) {
            session.addMessage({
              role: "system",
              content: `
                You are an Interview Coordinator assistant for ${
                  userData?.username || "the candidate"
                }.
                
                Your tasks:
                1. Acknowledge the user is here for an interview
                2. Ask about their desired position and experience
                3. Schedule an interview time
                4. Collect any additional relevant information
                
                When you've gathered interview preferences and scheduled a time, call 'complete_interview' to finish.
                Be professional, encouraging, and thorough.
                `,
              date: new Date().toISOString(),
            });
            session.setVariable("promptInitiated", true);
          }

          const messages = session.getMessages().map(({ role, content }) => ({
            role,
            content,
          }));

          const stream = await openai.chat.completions.create({
            model: defaultModel,
            messages,
            stream: true,
            tools: [
              {
                type: "function",
                function: {
                  name: "complete_interview",
                  description: "Call when interview scheduling is complete",
                  parameters: {
                    type: "object",
                    properties: {
                      position: {
                        type: "string",
                        description: "Position applied for",
                      },
                      experience_years: {
                        type: "integer",
                        description: "Years of experience",
                      },
                      interview_date: {
                        type: "string",
                        description: "Scheduled interview date/time",
                      },
                      notes: {
                        type: "string",
                        description: "Additional notes",
                      },
                    },
                    required: ["position", "interview_date"],
                  },
                },
              },
            ],
          });

          const aiMessage = {
            role: "assistant",
            content: "",
            date: new Date().toISOString(),
          };

          let toolCalls = [];
          let currentToolIndex = -1;

          for await (const chunk of stream) {
            const choice = chunk.choices?.[0];
            const delta = choice?.delta?.content || "";

            if (delta) {
              aiMessage.content += delta;
              socket.emit("ai-message-stream", delta);
            }

            if (choice?.delta?.tool_calls) {
              for (const toolCall of choice.delta.tool_calls) {
                const index = toolCall.index;

                if (index !== currentToolIndex) {
                  currentToolIndex = index;
                  toolCalls[index] = {
                    id: toolCall.id || "",
                    type: "function",
                    function: {
                      name: toolCall.function?.name || "",
                      arguments: toolCall.function?.arguments || "",
                    },
                  };
                } else if (toolCalls[index]) {
                  if (toolCall.function?.name) {
                    toolCalls[index].function.name += toolCall.function.name;
                  }
                  if (toolCall.function?.arguments) {
                    toolCalls[index].function.arguments +=
                      toolCall.function.arguments;
                  }
                }
              }
            }
          }

          // Process completion
          for (const toolCall of toolCalls) {
            if (toolCall?.function?.name === "complete_interview") {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                session.setVariable("interviewData", args);
                socket.emit("interview-scheduled", args);
                console.log("Interview scheduled:", args);
                session.setVariable("promptInitiated", false);
              } catch (e) {
                console.error("Failed to parse interview completion:", e);
              }
            }
          }

          socket.emit("ai-message", aiMessage);
          session.addMessage(aiMessage);

          const messageCount = session.getVariable("messageCount", 0);
          session.setVariable("messageCount", messageCount + 2);

          return { nextNode: "end" };
        } catch (error) {
          console.error("Error in interview node:", error);
          socket.emit("error", { message: "Interview scheduling failed" });
          return { nextNode: "end" };
        }
      },
    },

    // ========================================
    // NODE 3: Sales Assistant
    // ========================================
    sales: {
      _id: "sales",
      task: async ({ session, socket, openai, defaultModel }) => {
        console.log("Sales Node - Starting sales conversation");

        try {
          const userData = session.getVariable("userData");

          if (session.getVariable("promptInitiated") == false) {
            session.addMessage({
              role: "system",
              content: `
                You are a Sales assistant helping ${
                  userData?.username || "the customer"
                }.
                
                Your tasks:
                1. Understand their product/service interests
                2. Present relevant options and pricing
                3. Address questions and concerns
                4. Guide them through the purchase process
                
                When the customer is ready to proceed or has all information, call 'complete_sales' to finish.
                Be helpful, informative, and customer-focused.
                `,
              date: new Date().toISOString(),
            });
          }

          const messages = session.getMessages().map(({ role, content }) => ({
            role,
            content,
          }));

          const stream = await openai.chat.completions.create({
            model: defaultModel,
            messages,
            stream: true,
            tools: [
              {
                type: "function",
                function: {
                  name: "complete_sales",
                  description: "Call when sales interaction is complete",
                  parameters: {
                    type: "object",
                    properties: {
                      product_interest: {
                        type: "string",
                        description:
                          "Product/service the customer is interested in",
                      },
                      price_discussed: {
                        type: "number",
                        description: "Price point discussed",
                      },
                      status: {
                        type: "string",
                        enum: ["purchased", "considering", "needs_followup"],
                        description: "Current sales status",
                      },
                      notes: {
                        type: "string",
                        description: "Important details or concerns",
                      },
                    },
                    required: ["product_interest", "status"],
                  },
                },
              },
            ],
          });

          const aiMessage = {
            role: "assistant",
            content: "",
            date: new Date().toISOString(),
          };

          let toolCalls = [];
          let currentToolIndex = -1;

          for await (const chunk of stream) {
            const choice = chunk.choices?.[0];
            const delta = choice?.delta?.content || "";

            if (delta) {
              aiMessage.content += delta;
              socket.emit("ai-message-stream", delta);
            }

            if (choice?.delta?.tool_calls) {
              for (const toolCall of choice.delta.tool_calls) {
                const index = toolCall.index;

                if (index !== currentToolIndex) {
                  currentToolIndex = index;
                  toolCalls[index] = {
                    id: toolCall.id || "",
                    type: "function",
                    function: {
                      name: toolCall.function?.name || "",
                      arguments: toolCall.function?.arguments || "",
                    },
                  };
                } else if (toolCalls[index]) {
                  if (toolCall.function?.name) {
                    toolCalls[index].function.name += toolCall.function.name;
                  }
                  if (toolCall.function?.arguments) {
                    toolCalls[index].function.arguments +=
                      toolCall.function.arguments;
                  }
                }
              }
            }
          }

          // Process completion
          for (const toolCall of toolCalls) {
            if (toolCall?.function?.name === "complete_sales") {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                session.setVariable("salesData", args);
                socket.emit("sales-completed", args);
                console.log("Sales interaction completed:", args);
              } catch (e) {
                console.error("Failed to parse sales completion:", e);
              }
            }
          }

          socket.emit("ai-message", aiMessage);
          session.addMessage(aiMessage);

          const messageCount = session.getVariable("messageCount", 0);
          session.setVariable("messageCount", messageCount + 2);

          return { nextNode: "end" };
        } catch (error) {
          console.error("Error in sales node:", error);
          socket.emit("error", { message: "Sales interaction failed" });
          return { nextNode: "end" };
        }
      },
    },

    // ========================================
    // NODE 4: End/Completion
    // ========================================
    end: {
      _id: "end",
      task: async ({ session, socket }) => {
        console.log("Workflow completed");

        const finalData = {
          userData: session.getVariable("userData"),
          interviewData: session.getVariable("interviewData"),
          salesData: session.getVariable("salesData"),
          routingReason: session.getVariable("routing_reason"),
        };

        socket.emit("workflow-complete", finalData);
        return { nextNode: null };
      },
    },
  },
};
