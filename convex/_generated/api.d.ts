/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activityLog from "../activityLog.js";
import type * as agentRuns from "../agentRuns.js";
import type * as agents from "../agents.js";
import type * as contentItems from "../contentItems.js";
import type * as events from "../events.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as memories from "../memories.js";
import type * as scheduledEvents from "../scheduledEvents.js";
import type * as tasks from "../tasks.js";
import type * as webhookEvents from "../webhookEvents.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activityLog: typeof activityLog;
  agentRuns: typeof agentRuns;
  agents: typeof agents;
  contentItems: typeof contentItems;
  events: typeof events;
  files: typeof files;
  http: typeof http;
  memories: typeof memories;
  scheduledEvents: typeof scheduledEvents;
  tasks: typeof tasks;
  webhookEvents: typeof webhookEvents;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
