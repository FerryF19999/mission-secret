import { internalMutation } from "./_generated/server";

// Seed initial data for the Mission Control dashboard
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Seed Agents
    const agents = [
      {
        name: "Friday",
        handle: "@friday",
        role: "Executive Assistant",
        status: "active" as const,
        capabilities: ["task_management", "scheduling", "research", "email"],
        lastActive: now,
        createdAt: now,
      },
      {
        name: "Jarvis",
        handle: "@jarvis",
        role: "System Architect",
        status: "idle" as const,
        capabilities: ["coding", "architecture", "devops", "debugging"],
        lastActive: now - 3600000,
        createdAt: now - day,
      },
      {
        name: "Neural",
        handle: "@neural",
        role: "Content Creator",
        status: "busy" as const,
        capabilities: ["writing", "editing", "social_media", "design"],
        lastActive: now,
        createdAt: now - day * 2,
      },
      {
        name: "Scout",
        handle: "@scout",
        role: "Research Analyst",
        status: "active" as const,
        capabilities: ["research", "analysis", "data_mining", "monitoring"],
        lastActive: now - 1800000,
        createdAt: now - day * 3,
      },
    ];

    for (const agent of agents) {
      await ctx.db.insert("agents", agent);
    }

    // Seed Tasks
    const tasks = [
      {
        title: "Deploy Mission Control Dashboard",
        description: "Complete the initial deployment of the mission control interface",
        status: "in_progress" as const,
        priority: "critical" as const,
        assignedTo: "@jarvis",
        dueDate: now + day,
        tags: ["deployment", "dashboard", "urgent"],
        createdAt: now - day,
        updatedAt: now,
      },
      {
        title: "Review content pipeline",
        description: "Review and approve pending content items",
        status: "pending" as const,
        priority: "high" as const,
        assignedTo: "@neural",
        dueDate: now + day * 2,
        tags: ["content", "review"],
        createdAt: now - day,
        updatedAt: now,
      },
      {
        title: "Research competitors",
        description: "Analyze competitor AI assistants and their capabilities",
        status: "pending" as const,
        priority: "medium" as const,
        assignedTo: "@scout",
        dueDate: now + day * 3,
        tags: ["research", "competitors"],
        createdAt: now - day * 2,
        updatedAt: now - day,
      },
      {
        title: "Schedule team sync",
        description: "Schedule weekly team synchronization meeting",
        status: "completed" as const,
        priority: "medium" as const,
        assignedTo: "@friday",
        dueDate: now - day,
        tags: ["scheduling", "meeting"],
        createdAt: now - day * 3,
        updatedAt: now - day,
      },
      {
        title: "Update documentation",
        description: "Update system documentation with new features",
        status: "pending" as const,
        priority: "low" as const,
        tags: ["docs", "documentation"],
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const task of tasks) {
      await ctx.db.insert("tasks", task);
    }

    // Seed Memories
    const memories = [
      {
        agentId: "@friday",
        type: "fact" as const,
        content: "User prefers dark mode interface for all applications",
        source: "user_profile",
        tags: ["preferences", "ui"],
        importance: 8,
        createdAt: now - day * 5,
      },
      {
        agentId: "@jarvis",
        type: "insight" as const,
        content: "API response times improved by 40% after last optimization",
        source: "performance_analysis",
        tags: ["performance", "api", "optimization"],
        importance: 7,
        createdAt: now - day * 2,
      },
      {
        type: "conversation" as const,
        content: "User asked about integrating new AI models into the system",
        source: "chat_log",
        tags: ["conversation", "ai", "integration"],
        importance: 6,
        createdAt: now - day,
      },
      {
        agentId: "@scout",
        type: "fact" as const,
        content: "Three new competitors entered the market this quarter",
        source: "market_research",
        tags: ["competitors", "market"],
        importance: 9,
        createdAt: now - day * 3,
      },
      {
        agentId: "@neural",
        type: "insight" as const,
        content: "Video content performs 3x better than text-only posts",
        source: "analytics",
        tags: ["content", "analytics", "strategy"],
        importance: 8,
        createdAt: now - day * 2,
      },
    ];

    for (const memory of memories) {
      await ctx.db.insert("memories", memory);
    }

    // Seed Content Items
    const contentItems = [
      {
        title: "Mission Control Launch Post",
        type: "post" as const,
        status: "scheduled" as const,
        platform: "twitter",
        content: "🚀 Introducing Mission Control - Your AI command center for managing tasks, agents, and content. Built with @nextjs and @convexdev. #AI #Productivity",
        scheduledFor: now + day,
        tags: ["launch", "announcement"],
        createdAt: now - day,
        updatedAt: now,
      },
      {
        title: "AI Agents Explained - Thread",
        type: "thread" as const,
        status: "draft" as const,
        platform: "twitter",
        content: "1/ AI agents are autonomous systems that can perform tasks on your behalf...",
        tags: ["education", "ai", "thread"],
        createdAt: now - day * 2,
        updatedAt: now - day,
      },
      {
        title: "Product Demo Video",
        type: "video" as const,
        status: "idea" as const,
        content: "Create a 2-minute demo showing Mission Control features",
        tags: ["demo", "video"],
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "Building with Convex - Article",
        type: "article" as const,
        status: "published" as const,
        platform: "blog",
        url: "https://example.com/blog/building-with-convex",
        content: "Learn how we built Mission Control using Convex for real-time data synchronization...",
        publishedAt: now - day * 2,
        tags: ["engineering", "convex", "tutorial"],
        createdAt: now - day * 5,
        updatedAt: now - day * 2,
      },
    ];

    for (const item of contentItems) {
      await ctx.db.insert("contentItems", item);
    }

    // Seed Scheduled Events
    const events = [
      {
        title: "Team Standup",
        description: "Daily team synchronization",
        startTime: now + day + 9 * 60 * 60 * 1000,
        endTime: now + day + 9 * 60 * 60 * 1000 + 30 * 60 * 1000,
        type: "meeting" as const,
        attendees: ["@friday", "@jarvis", "@neural", "@scout"],
        location: "Virtual - Zoom",
        color: "#10b981",
        createdAt: now - day,
        updatedAt: now,
      },
      {
        title: "Content Review",
        description: "Review scheduled content before publishing",
        startTime: now + day * 2 + 14 * 60 * 60 * 1000,
        endTime: now + day * 2 + 15 * 60 * 60 * 1000,
        type: "meeting" as const,
        attendees: ["@neural", "@friday"],
        location: "Virtual",
        color: "#8b5cf6",
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "Launch Deadline",
        description: "Mission Control v1.0 must be live",
        startTime: now + day * 3,
        endTime: now + day * 3,
        allDay: true,
        type: "deadline" as const,
        color: "#ef4444",
        createdAt: now - day * 3,
        updatedAt: now,
      },
    ];

    for (const event of events) {
      await ctx.db.insert("scheduledEvents", event);
    }

    // Seed Activity Log
    const activities = [
      {
        runId: "init-001",
        action: "system_initialized",
        source: "system",
        createdAt: now,
      },
      {
        runId: "agent-001",
        action: "agent_activated",
        source: "@friday",
        metadata: { agent: "@friday" },
        createdAt: now - 3600000,
      },
      {
        runId: "task-001",
        action: "task_completed",
        source: "@jarvis",
        metadata: { task: "Setup Convex schema" },
        createdAt: now - day,
      },
    ];

    for (const activity of activities) {
      await ctx.db.insert("activityLog", activity);
    }

    return {
      success: true,
      seeded: {
        agents: agents.length,
        tasks: tasks.length,
        memories: memories.length,
        contentItems: contentItems.length,
        events: events.length,
        activities: activities.length,
      },
    };
  },
});
