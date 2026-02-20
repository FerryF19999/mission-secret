"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { StatCard } from "@/components/StatCard";
import { Card } from "@/components/Card";
import { TaskStatusBadge } from "@/components/TaskBadges";
import { AgentStatusBadge } from "@/components/AgentStatusBadge";
import { ContentStatusBadge } from "@/components/ContentBadges";
import {
  CheckSquare,
  Bot,
  FileText,
  Calendar,
  Zap,
  Clock,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";

export default function DashboardPage() {
  const taskStats = useQuery(api.tasks.getStats);
  const agentStats = useQuery(api.agents.getStats);
  const contentStats = useQuery(api.contentItems.getStats);
  const eventStats = useQuery(api.scheduledEvents.getStats);
  const recentTasks = useQuery(api.tasks.getAll, { limit: 5 });
  const agents = useQuery(api.agents.getAll);
  const recentContent = useQuery(api.contentItems.getAll, { limit: 5 });
  const upcomingEvents = useQuery(api.scheduledEvents.getUpcoming, { hours: 24 });
  const activities = useQuery(api.activityLog.getAll, { limit: 10 });

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back to Mission Control. Here&apos;s what&apos;s happening.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span className="font-mono">{new Date().toLocaleString()}</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Active Tasks"
          value={taskStats ? taskStats.inProgress + taskStats.pending : "..."}
          subtitle={`${taskStats?.completed || 0} completed`}
          icon={<CheckSquare className="w-6 h-6 text-blue-400" />}
          color="blue"
        />
        <StatCard
          title="Team Members"
          value={agentStats ? agentStats.active + agentStats.idle : "..."}
          subtitle={`${agentStats?.active || 0} active now`}
          icon={<Bot className="w-6 h-6 text-emerald-400" />}
          color="green"
        />
        <StatCard
          title="Content Pipeline"
          value={contentStats ? contentStats.drafts + contentStats.scheduled : "..."}
          subtitle={`${contentStats?.published || 0} published`}
          icon={<FileText className="w-6 h-6 text-purple-400" />}
          color="purple"
        />
        <StatCard
          title="Upcoming Events"
          value={eventStats?.today || 0}
          subtitle={`${eventStats?.thisWeek || 0} this week`}
          icon={<Calendar className="w-6 h-6 text-amber-400" />}
          color="amber"
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Tasks */}
        <Card title="Recent Tasks" action={
          <Link href="/tasks" className="text-sm text-primary hover:underline flex items-center gap-1">
            View all <ArrowRight className="w-4 h-4" />
          </Link>
        }>
          <div className="space-y-3">
            {recentTasks?.map((task) => (
              <div
                key={task._id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{task.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {task.assignedTo ? `Assigned to ${task.assignedTo}` : "Unassigned"}
                  </p>
                </div>
                <TaskStatusBadge status={task.status} />
              </div>
            ))}
            {(!recentTasks || recentTasks.length === 0) && (
              <p className="text-muted-foreground text-center py-4">No tasks yet</p>
            )}
          </div>
        </Card>

        {/* Team Status */}
        <Card title="Team Status" action={
          <Link href="/team" className="text-sm text-primary hover:underline flex items-center gap-1">
            View all <ArrowRight className="w-4 h-4" />
          </Link>
        }>
          <div className="space-y-3">
            {agents?.map((agent) => (
              <div
                key={agent._id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold">
                    {agent.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-medium">{agent.name}</p>
                    <p className="text-sm text-muted-foreground">{agent.role}</p>
                  </div>
                </div>
                <AgentStatusBadge status={agent.status} />
              </div>
            ))}
            {(!agents || agents.length === 0) && (
              <p className="text-muted-foreground text-center py-4">No agents yet</p>
            )}
          </div>
        </Card>

        {/* Activity Feed */}
        <Card title="Activity Feed">
          <div className="space-y-3 max-h-[400px] overflow-auto">
            {activities?.map((activity) => (
              <div
                key={activity._id}
                className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
              >
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Zap className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm">{activity.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {activity.source} • {new Date(activity.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
            {(!activities || activities.length === 0) && (
              <p className="text-muted-foreground text-center py-4">No activity yet</p>
            )}
          </div>
        </Card>
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Content Pipeline */}
        <Card title="Content Pipeline" action={
          <Link href="/content" className="text-sm text-primary hover:underline flex items-center gap-1">
            View all <ArrowRight className="w-4 h-4" />
          </Link>
        }>
          <div className="space-y-3">
            {recentContent?.map((item) => (
              <div
                key={item._id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{item.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.platform || "No platform"}
                  </p>
                </div>
                <ContentStatusBadge status={item.status} />
              </div>
            ))}
            {(!recentContent || recentContent.length === 0) && (
              <p className="text-muted-foreground text-center py-4">No content yet</p>
            )}
          </div>
        </Card>

        {/* Upcoming Events */}
        <Card title="Upcoming Events" action={
          <Link href="/calendar" className="text-sm text-primary hover:underline flex items-center gap-1">
            View all <ArrowRight className="w-4 h-4" />
          </Link>
        }>
          <div className="space-y-3">
            {upcomingEvents?.map((event) => (
              <div
                key={event._id}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
              >
                <div
                  className="w-1 h-12 rounded-full"
                  style={{ backgroundColor: event.color || "#3b82f6" }}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{event.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(event.startTime).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
            {(!upcomingEvents || upcomingEvents.length === 0) && (
              <p className="text-muted-foreground text-center py-4">No upcoming events</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
