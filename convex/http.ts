import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

// OpenClaw webhook endpoint
http.route({
  path: "/openclaw/event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const expected = process.env.OPENCLAW_WEBHOOK_TOKEN || "123bearandbear";
      const auth = request.headers.get("authorization") || "";
      if (expected) {
        const ok = auth.toLowerCase().startsWith("bearer ") && auth.slice(7).trim() === expected;
        if (!ok) {
          return new Response(JSON.stringify({ success: false, error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      const body = await request.json();
      
      // Simple log to activityLog - direct db
      try {
        await ctx.db.insert("activityLog", {
          runId: body.runId || `webhook-${Date.now()}`,
          action: body.type || "webhook",
          source: "openclaw",
          createdAt: Date.now(),
          metadata: { payload: body },
        });
      } catch (e) {
        // Ignore logging errors
      }

      // Handle different event types
      switch (body.type) {
        case "agent_run_started": {
          // Create agent run
          await ctx.db.insert("agentRuns", {
            runId: body.runId,
            sessionKey: body.sessionKey,
            label: body.label,
            agentId: body.agentId,
            agentName: body.agentName || body.agentId,
            task: body.task,
            status: body.status || "running",
            startedAt: body.startedAt || Date.now(),
            completedAt: undefined,
            result: undefined,
            resultFiles: [],
          });

          // Auto-create task in Tasks table
          await ctx.db.insert("tasks", {
            title: body.task,
            description: `Agent: ${body.agentName || body.agentId} | Run: ${body.runId}`,
            status: "in_progress",
            priority: "medium",
            assignedTo: body.agentName || body.agentId,
            tags: ["auto-generated", "agent-run"],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          break;
        }

        case "agent_run_completed": {
          const docC = await ctx.db
            .query("agentRuns")
            .withIndex("by_runId", (q) => q.eq("runId", body.runId))
            .first();
          if (docC) {
            await ctx.db.patch(docC._id, {
              status: "completed",
              result: body.result,
              completedAt: Date.now(),
            });
          }

          const tasksC = await ctx.db.query("tasks").collect();
          const linkedC = tasksC.find(
            (t: any) => t.description && t.description.includes(`Run: ${body.runId}`)
          );
          if (linkedC) {
            await ctx.db.patch(linkedC._id, { status: "completed", updatedAt: Date.now() });
          }
          break;
        }

        case "agent_run_failed": {
          const docF = await ctx.db
            .query("agentRuns")
            .withIndex("by_runId", (q) => q.eq("runId", body.runId))
            .first();
          if (docF) {
            await ctx.db.patch(docF._id, {
              status: "failed",
              result: body.error || body.result,
              completedAt: Date.now(),
            });
          }

          const tasksF = await ctx.db.query("tasks").collect();
          const linkedF = tasksF.find(
            (t: any) => t.description && t.description.includes(`Run: ${body.runId}`)
          );
          if (linkedF) {
            await ctx.db.patch(linkedF._id, { status: "cancelled", updatedAt: Date.now() });
          }
          break;
        }

        case "agent_run_log": {
          await ctx.db.insert("activityLog", {
            runId: body.runId,
            action: body.action || "log",
            prompt: body.prompt,
            response: body.message || body.response,
            source: body.source || body.agentId || "openclaw",
            createdAt: Date.now(),
            metadata: body.metadata,
          });
          break;
        }

        case "agent_run_file_init": {
          const uploadUrl = await ctx.storage.generateUploadUrl();
          return new Response(JSON.stringify({ success: true, uploadUrl }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        case "agent_run_file_commit": {
          // Add file to agentRun's resultFiles array
          const doc = await ctx.db
            .query("agentRuns")
            .withIndex("by_runId", (q) => q.eq("runId", body.runId))
            .first();
          if (doc) {
            const files = (doc.resultFiles as any[]) || [];
            files.push({
              storageId: body.storageId,
              filename: body.filename || `file-${Date.now()}`,
              contentType: body.contentType,
              size: body.size,
              createdAt: Date.now(),
            });
            await ctx.db.patch(doc._id, { resultFiles: files });
          }
          break;
        }

        case "agent_run_file_remove": {
          // Remove file from agentRun's resultFiles array
          const doc = await ctx.db
            .query("agentRuns")
            .withIndex("by_runId", (q) => q.eq("runId", body.runId))
            .first();
          if (doc) {
            const files = ((doc.resultFiles as any[]) || []).filter(
              (f: any) => f.storageId !== body.storageId
            );
            await ctx.db.patch(doc._id, { resultFiles: files });
          }
          break;
        }

        case "task_created": {
          await ctx.db.insert("tasks", {
            title: body.title,
            description: body.description,
            priority: body.priority || "medium",
            assignedTo: body.assignedTo,
            tags: body.tags || [],
            status: "todo",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          if (body.dueDate) {
            await ctx.db.insert("scheduledEvents", {
              title: `Task: ${body.title}`,
              description: body.description || `Priority: ${body.priority || "medium"}`,
              startTime: body.dueDate,
              endTime: body.dueDate + 60 * 60 * 1000,
              type: "task",
              createdAt: Date.now(),
            });
          }
          break;
        }

        case "memory_created": {
          await ctx.db.insert("memories", {
            agentId: body.agentId,
            type: body.memoryType || "fact",
            content: body.content,
            source: body.source,
            tags: body.tags || [],
            importance: body.importance || 5,
            createdAt: Date.now(),
          });
          break;
        }

        case "content_created": {
          await ctx.db.insert("contentItems", {
            title: body.title,
            type: body.contentType || "post",
            platform: body.platform,
            content: body.content,
            status: "draft",
            tags: body.tags || [],
            scheduledFor: body.scheduledFor,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          if (body.scheduledFor) {
            await ctx.db.insert("scheduledEvents", {
              title: `Content: ${body.title}`,
              description: `${body.platform || "post"} - ${body.status || "draft"}`,
              startTime: body.scheduledFor,
              endTime: body.scheduledFor + 30 * 60 * 1000,
              type: "content",
              createdAt: Date.now(),
            });
          }
          break;
        }

        case "event_created": {
          await ctx.db.insert("scheduledEvents", {
            title: body.title,
            description: body.description,
            startTime: body.startTime,
            endTime: body.endTime,
            type: body.eventType || "general",
            createdAt: Date.now(),
          });
          break;
        }

        case "agent_status_update": {
          const agents = await ctx.db.query("agents").collect();
          const agent = agents.find(
            (a: any) => a.handle === body.agentId || (a.name && a.name.toLowerCase() === body.agentId.toLowerCase())
          );
          if (agent) {
            await ctx.db.patch(agent._id, {
              status: body.status,
              lastActive: Date.now(),
            });
          }
          break;
        }

        default:
          // Unknown event type - just log it
          break;
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ success: false, error: String(e) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

export default http;
