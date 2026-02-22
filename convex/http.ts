import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

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
      
      // Log the incoming webhook
      await ctx.runMutation(api.activityLog.create, {
        runId: body.runId || `webhook-${Date.now()}`,
        action: "webhook_received",
        source: "openclaw",
        metadata: {
          eventType: body.type || "unknown",
          payload: body,
        },
      });

      // Also update agent status (Team) on activity - direct db
      if (body.agentId) {
        const agents = await ctx.db.query("agents").collect();
        const agent = agents.find((a: any) => a.handle === body.agentId || (a.name && a.name.toLowerCase() === body.agentId.toLowerCase()));
        if (agent) {
          const newStatus = body.type === "agent_run_started" ? "busy" : "active";
          await ctx.db.patch(agent._id, {
            status: newStatus,
            lastActive: Date.now(),
          });
        }
      }

      // Handle different event types
      switch (body.type) {
        case "agent_run_started":
          // Create agent run - use direct db access
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

        case "agent_run_status":
          await ctx.runMutation((api as any).agentRuns.setStatusByRunId, {
            runId: body.runId,
            status: body.status,
          });
          break;

        case "agent_run_completed": {
          // Update agent run - direct db
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

          // Update linked task to completed
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
          // Update agent run - direct db
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

          // Update linked task to cancelled
          const tasksF = await ctx.db.query("tasks").collect();
          const linkedF = tasksF.find(
            (t: any) => t.description && t.description.includes(`Run: ${body.runId}`)
          );
          if (linkedF) {
            await ctx.db.patch(linkedF._id, { status: "cancelled", updatedAt: Date.now() });
          }
          break;
        }

        case "agent_run_log":
          await ctx.runMutation(api.activityLog.create, {
            runId: body.runId,
            action: body.action || "log",
            prompt: body.prompt,
            response: body.message || body.response,
            source: body.source || body.agentId || "openclaw",
            metadata: body.metadata,
          });
          break;

        case "agent_run_file_init": {
          // Returns a signed upload URL. Client should PUT bytes to it.
          const uploadUrl = await ctx.runMutation((api as any).files.generateUploadUrl, {});
          return new Response(JSON.stringify({ success: true, uploadUrl }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        case "agent_run_file_remove": {
          await ctx.runMutation((api as any).agentRuns.removeFileByRunId, {
            runId: body.runId,
            storageId: body.storageId,
          });
          break;
        }

        case "agent_run_file_commit": {
          // After uploading to uploadUrl, client sends storageId + metadata to attach it to run.
          await ctx.runMutation((api as any).agentRuns.addFileByRunId, {
            runId: body.runId,
            storageId: body.storageId,
            filename: body.filename || `file-${Date.now()}`,
            contentType: body.contentType,
            size: body.size,
          });

          await ctx.runMutation(api.activityLog.create, {
            runId: body.runId,
            action: "file",
            response: `Attached file: ${body.filename || "(unnamed)"}`,
            source: body.source || body.agentId || "openclaw",
            metadata: {
              filename: body.filename,
              contentType: body.contentType,
              size: body.size,
              storageId: body.storageId,
            },
          });
          break;
        }

        case "agent_run_file": {
          // Small file shortcut (base64). Note: Convex action input limit is ~1MiB.
          const bin = Buffer.from(body.dataBase64, "base64");
          if (bin.length > 900_000) {
            return new Response(
              JSON.stringify({
                success: false,
                error: "file_too_large_for_base64",
                hint: "Use agent_run_file_init + uploadUrl PUT + agent_run_file_commit",
              }),
              { status: 413, headers: { "Content-Type": "application/json" } }
            );
          }

          const blob = new Blob([bin], { type: body.contentType || "application/octet-stream" });
          const storageId = await ctx.storage.store(blob);

          await ctx.runMutation((api as any).agentRuns.addFileByRunId, {
            runId: body.runId,
            storageId,
            filename: body.filename || `file-${Date.now()}`,
            contentType: body.contentType,
            size: body.size || bin.length,
          });

          await ctx.runMutation(api.activityLog.create, {
            runId: body.runId,
            action: "file",
            response: `Stored file: ${body.filename || "(unnamed)"}`,
            source: body.source || body.agentId || "openclaw",
            metadata: {
              filename: body.filename,
              contentType: body.contentType,
              size: body.size || bin.length,
              storageId,
            },
          });
          break;
        }
        case "task_created":
          await ctx.runMutation(api.tasks.create, {
            title: body.title,
            description: body.description,
            priority: body.priority || "medium",
            assignedTo: body.assignedTo,
            tags: body.tags,
          });

          // Auto-create calendar event if dueDate is provided
          if (body.dueDate) {
            await ctx.runMutation(api.scheduledEvents.create, {
              title: `Task: ${body.title}`,
              description: body.description || `Priority: ${body.priority || "medium"}`,
              startTime: body.dueDate,
              endTime: body.dueDate + 60 * 60 * 1000, // 1 hour later
              type: "task",
            });
          }
          break;

        case "memory_created":
          await ctx.runMutation(api.memories.create, {
            agentId: body.agentId,
            type: body.memoryType || "fact",
            content: body.content,
            source: body.source,
            tags: body.tags,
            importance: body.importance,
          });
          break;

        case "content_created":
          await ctx.runMutation(api.contentItems.create, {
            title: body.title,
            type: body.contentType || "post",
            platform: body.platform,
            content: body.content,
            tags: body.tags,
          });
          break;

        case "event_created":
          await ctx.runMutation(api.scheduledEvents.create, {
            title: body.title,
            description: body.description,
            startTime: body.startTime,
            endTime: body.endTime,
            type: body.eventType || "event",
            attendees: body.attendees,
            location: body.location,
          });
          break;

        case "agent_status_update":
          if (body.agentId) {
            await ctx.runMutation(api.agents.setStatus, {
              id: body.agentId,
              status: body.status || "idle",
            });
          }
          break;
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Webhook error:", error);
      return new Response(
        JSON.stringify({ success: false, error: String(error) }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }),
});

// Health check endpoint
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
