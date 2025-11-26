/**
 * Pub/Sub usage example for @dataplan/pg-bun
 */

import { makePgService } from "../src/index.js";

// Example 1: Basic Pub/Sub setup
const pgService = makePgService({
  connectionString: "postgres://localhost:5432/mydb",
  schemas: ["public"],
  pubsub: true,
  subscriberOptions: {
    pollInterval: 1000,
    tableName: "pg_notify_queue",
    autoCreateTable: true,
    messageRetention: 3600,
  },
});

// Example 2: Simple notification system
async function simpleNotificationExample() {
  const subscriber = pgService.pgSubscriber;
  
  if (!subscriber) {
    throw new Error("Subscriber not configured");
  }
  
  // Subscribe to a channel
  const notifications = subscriber.subscribe("example_channel");
  
  console.log("Subscribed to example_channel, waiting for messages...");
  
  // Send a notification
  await subscriber.notify("example_channel", "Hello, World!");
  
  // Listen for messages
  for await (const payload of notifications) {
    console.log("Received notification:", payload);
    
    // Break after receiving one message for demo
    break;
  }
}

// Example 3: Multi-channel subscription
async function multiChannelExample() {
  const subscriber = pgService.pgSubscriber;
  
  if (!subscriber) {
    throw new Error("Subscriber not configured");
  }
  
  // Subscribe to multiple channels
  const chatNotifications = subscriber.subscribe("chat_messages");
  const systemNotifications = subscriber.subscribe("system_events");
  
  // Send messages to different channels
  await subscriber.notify("chat_messages", JSON.stringify({
    user: "Alice",
    message: "Hello everyone!",
    timestamp: new Date().toISOString(),
  }));
  
  await subscriber.notify("system_events", JSON.stringify({
    type: "user_login",
    user_id: 123,
    timestamp: new Date().toISOString(),
  }));
  
  // Listen to all channels (in separate async contexts)
  const chatPromise = (async () => {
    for await (const payload of chatNotifications) {
      console.log("Chat:", JSON.parse(payload));
    }
  })();
  
  const systemPromise = (async () => {
    for await (const payload of systemNotifications) {
      console.log("System:", JSON.parse(payload));
    }
  })();
  
  // Simulate receiving messages
  setTimeout(async () => {
    await subscriber.notify("chat_messages", JSON.stringify({
      user: "Bob",
      message: "Hi Alice!",
      timestamp: new Date().toISOString(),
    }));
    
    await subscriber.notify("system_events", JSON.stringify({
      type: "user_logout",
      user_id: 456,
      timestamp: new Date().toISOString(),
    }));
  }, 2000);
  
  // Wait a bit then clean up
  setTimeout(() => {
    console.log("Cleaning up subscriptions...");
    subscriber.release();
  }, 5000);
}

// Example 4: Real-time chat room
class ChatRoom {
  private messages: string[] = [];
  
  constructor(
    private subscriber: any,
    private roomName: string
  ) {}
  
  async join(username: string): Promise<void> {
    const notifications = this.subscriber.subscribe(this.roomName);
    
    // Send join message
    await this.subscriber.notify(this.roomName, JSON.stringify({
      type: "join",
      username,
      timestamp: new Date().toISOString(),
    }));
    
    // Listen for messages
    for await (const payload of notifications) {
      const message = JSON.parse(payload);
      this.handleMessage(message);
      
      // Exit condition for demo
      if (message.type === "leave" && message.username === username) {
        break;
      }
    }
  }
  
  async sendMessage(username: string, content: string): Promise<void> {
    await this.subscriber.notify(this.roomName, JSON.stringify({
      type: "message",
      username,
      content,
      timestamp: new Date().toISOString(),
    }));
  }
  
  private handleMessage(message: any): void {
    this.messages.push(JSON.stringify(message));
    
    switch (message.type) {
      case "join":
        console.log(`👋 ${message.username} joined the chat`);
        break;
      case "message":
        console.log(`💬 ${message.username}: ${message.content}`);
        break;
      case "leave":
        console.log(`👋 ${message.username} left the chat`);
        break;
    }
  }
  
  getHistory(): string[] {
    return [...this.messages];
  }
}

async function chatRoomExample() {
  const subscriber = pgService.pgSubscriber;
  
  if (!subscriber) {
    throw new Error("Subscriber not configured");
  }
  
  const room = new ChatRoom(subscriber, "general");
  
  console.log("Starting chat room demo...");
  
  // Simulate multiple users
  setTimeout(() => {
    room.sendMessage("Alice", "Hello everyone!");
  }, 1000);
  
  setTimeout(() => {
    room.sendMessage("Bob", "Hi Alice!");
  }, 2000);
  
  setTimeout(() => {
    room.sendMessage("Alice", "How are you, Bob?");
  }, 3000);
  
  // Alice joins the chat
  await room.join("Alice");
  
  console.log("Chat history:", room.getHistory());
}

// Example 5: Task queue system
class TaskQueue {
  private workers = new Map<string, (task: any) => Promise<any>>();
  
  constructor(private subscriber: any) {}
  
  registerWorker(taskType: string, handler: (task: any) => Promise<any>): void {
    this.workers.set(taskType, handler);
    
    // Start listening for tasks
    this.listenForTasks(taskType);
  }
  
  private async listenForTasks(taskType: string): Promise<void> {
    const notifications = this.subscriber.subscribe(`tasks:${taskType}`);
    
    for await (const payload of notifications) {
      const task = JSON.parse(payload);
      console.log(`Processing ${taskType} task:`, task);
      
      try {
        const handler = this.workers.get(taskType);
        if (handler) {
          const result = await handler(task);
          console.log(`Task completed:`, result);
          
          // Send completion notification
          await this.subscriber.notify(`task_results:${taskType}`, JSON.stringify({
            taskId: task.taskId,
            result,
            status: "completed",
            timestamp: new Date().toISOString(),
          }));
        }
      } catch (error) {
        console.error(`Task failed:`, error);
        
        // Send failure notification
        await this.subscriber.notify(`task_results:${taskType}`, JSON.stringify({
          taskId: task.taskId,
          error: error.message,
          status: "failed",
          timestamp: new Date().toISOString(),
        }));
      }
    }
  }
  
  async enqueue(taskType: string, data: any): Promise<void> {
    const task = {
      taskId: Math.random().toString(36).substr(2, 9),
      type: taskType,
      data,
      timestamp: new Date().toISOString(),
    };
    
    await this.subscriber.notify(`tasks:${taskType}`, JSON.stringify(task));
    console.log(`Enqueued ${taskType} task:`, task.taskId);
  }
}

async function taskQueueExample() {
  const subscriber = pgService.pgSubscriber;
  
  if (!subscriber) {
    throw new Error("Subscriber not configured");
  }
  
  const queue = new TaskQueue(subscriber);
  
  // Register workers
  queue.registerWorker("send_email", async (task) => {
    console.log(`Sending email to ${task.data.to}: ${task.data.subject}`);
    // Simulate email sending
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { sent: true, messageId: "msg_" + task.taskId };
  });
  
  queue.registerWorker("process_image", async (task) => {
    console.log(`Processing image: ${task.data.filename}`);
    // Simulate image processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    return { processed: true, size: "1024x768" };
  });
  
  // Enqueue some tasks
  await queue.enqueue("send_email", {
    to: "user@example.com",
    subject: "Welcome!",
    body: "Thank you for signing up.",
  });
  
  await queue.enqueue("process_image", {
    filename: "photo.jpg",
    filters: ["resize", "optimize"],
  });
  
  await queue.enqueue("send_email", {
    to: "admin@example.com",
    subject: "Daily Report",
    body: "Here's your daily report.",
  });
  
  // Let tasks process
  setTimeout(() => {
    console.log("Task queue demo completed");
    subscriber.release();
  }, 10000);
}

// Export for use in tests or other files
export {
  simpleNotificationExample,
  multiChannelExample,
  chatRoomExample,
  taskQueueExample,
  ChatRoom,
  TaskQueue,
};

// Run examples if this file is executed directly
// Note: Using a simple check for execution context
if (typeof require !== 'undefined' && require.main === module) {
  console.log("=== Pub/Sub Usage Examples ===\n");
  
  console.log("1. Simple notification example:");
  await simpleNotificationExample();
  
  console.log("\n2. Multi-channel subscription:");
  await multiChannelExample();
  
  console.log("\n3. Chat room example:");
  await chatRoomExample();
  
  console.log("\n4. Task queue example:");
  await taskQueueExample();
  
  console.log("\nAll pub/sub examples completed!");
}