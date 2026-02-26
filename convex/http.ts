import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

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
      
      // Route to internal mutations based on event type
      switch (body.type) {
        case "agent_run_started":
          await ctx.runMutation((internal as any).webhookEvents.handleAgentRunStarted, {
            runId: body.runId,
            sessionKey: body.sessionKey,
            label: body.label,
            agentId: body.agentId,
            agentName: body.agentName,
            task: body.task,
            status: body.status,
            startedAt: body.startedAt,
            triggeredBy: body.triggeredBy,
            modelUsed: body.modelUsed,
            toolsUsed: body.toolsUsed,
            notes: body.notes,
          });
          break;

        case "agent_run_completed":
          await ctx.runMutation((internal as any).webhookEvents.handleAgentRunCompleted, {
            runId: body.runId,
            result: body.result,
            modelUsed: body.modelUsed,
            toolsUsed: body.toolsUsed,
            errorLog: body.errorLog,
            notes: body.notes,
          });
          break;

        case "agent_run_failed":
          await ctx.runMutation((internal as any).webhookEvents.handleAgentRunFailed, {
            runId: body.runId,
            error: body.error,
            result: body.result,
          });
          break;

        case "agent_run_log":
          await ctx.runMutation((internal as any).webhookEvents.handleAgentRunLog, {
            runId: body.runId,
            action: body.action,
            prompt: body.prompt,
            message: body.message,
            source: body.source,
            metadata: body.metadata,
          });
          break;

        case "agent_run_file_commit": {
          // If base64 content is provided, upload to Convex storage first
          let storageId = body.storageId;
          let fileSize = body.size;

          if (body.content) {
            // Decode base64 content
            const raw = atob(body.content);
            const bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

            // Determine MIME type
            const mime = body.mimeType || body.contentType || "application/octet-stream";

            // Store in Convex storage
            storageId = await ctx.storage.store(new Blob([bytes], { type: mime }));
            fileSize = bytes.length;
          }

          if (storageId) {
            await ctx.runMutation((internal as any).webhookEvents.handleAgentRunFileCommit, {
              runId: body.runId,
              storageId,
              filename: body.filename,
              contentType: body.mimeType || body.contentType,
              size: fileSize,
              agentId: body.agentId,
              agentName: body.agentName,
              task: body.task,
            });
          }
          break;
        }

        case "task_created":
          await ctx.runMutation((internal as any).webhookEvents.handleTaskCreated, {
            title: body.title,
            description: body.description,
            priority: body.priority,
            assignedTo: body.assignedTo,
            tags: body.tags,
            dueDate: body.dueDate,
          });
          break;

        case "content_created":
          await ctx.runMutation((internal as any).webhookEvents.handleContentCreated, {
            title: body.title,
            contentType: body.contentType,
            platform: body.platform,
            content: body.content,
            tags: body.tags,
            scheduledFor: body.scheduledFor,
          });
          break;

        case "memory_created":
          await ctx.runMutation((internal as any).webhookEvents.handleMemoryCreated, {
            agentId: body.agentId,
            memoryType: body.memoryType,
            content: body.content,
            source: body.source,
            tags: body.tags,
            importance: body.importance,
          });
          break;

        case "event_created":
          await ctx.runMutation((internal as any).webhookEvents.handleEventCreated, {
            title: body.title,
            description: body.description,
            startTime: body.startTime,
            endTime: body.endTime,
            eventType: body.eventType,
          });
          break;

        case "agent_registered":
          await ctx.runMutation((internal as any).webhookEvents.handleAgentRegistered, {
            agentId: body.agentId,
            agentName: body.agentName,
            role: body.role,
            parentAgent: body.parentAgent,
            status: body.status,
            capabilities: body.capabilities,
            avatar: body.avatar,
          });
          break;

        case "agent_status_update":
          await ctx.runMutation((internal as any).webhookEvents.handleAgentStatusUpdate, {
            agentId: body.agentId,
            status: body.status,
          });
          break;

        default:
          // Unknown event type - just acknowledge
          break;
      }

      return new Response(JSON.stringify({ success: true, type: body.type }), {
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
