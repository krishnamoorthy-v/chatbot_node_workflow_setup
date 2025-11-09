import { randomUUID } from "crypto";

export class ChatSession {
  constructor({ id, initialMessages = [], initialVariables = {} } = {}) {
    this.id = id ?? randomUUID();
    this._messages = [...initialMessages];
    this._variables = new Map(Object.entries(initialVariables));
  }

  addMessage(message) {
    if (!message || typeof message !== "object") {
      throw new TypeError("message must be an object.");
    }
    this._messages.push({ ...message });
    return this;
  }

  getMessages() {
    return this._messages.map((message) => ({ ...message }));
  }

  clearMessages() {
    this._messages.length = 0;
    return this;
  }

  setVariable(key, value) {
    if (typeof key !== "string" || !key.length) {
      throw new TypeError("key must be a non-empty string.");
    }
    this._variables.set(key, value);
    return this;
  }

  getVariable(key, fallback) {
    return this._variables.has(key) ? this._variables.get(key) : fallback;
  }

  deleteVariable(key) {
    return this._variables.delete(key);
  }

  getVariables() {
    return Object.fromEntries(this._variables.entries());
  }

  clearVariables() {
    this._variables.clear();
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      messages: this.getMessages(),
      variables: this.getVariables(),
    };
  }
}

export function createChatSession(options) {
  return new ChatSession(options);
}
