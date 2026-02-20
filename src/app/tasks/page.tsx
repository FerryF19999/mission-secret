"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { TaskStatusBadge, TaskPriorityBadge } from "@/components/TaskBadges";
import { Task, TaskStatus, TaskPriority } from "@/types";
import { Plus, Filter, Search, Trash2, Edit } from "lucide-react";

const statusFilters: (TaskStatus | "all")[] = ["all", "pending", "in_progress", "completed", "cancelled"];

export default function TasksPage() {
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const tasks = useQuery(api.tasks.getAll, filter === "all" ? {} : { status: filter });
  const stats = useQuery(api.tasks.getStats);
  const createTask = useMutation(api.tasks.create);
  const deleteTask = useMutation(api.tasks.remove);

  const filteredTasks = tasks?.filter(task =>
    task.title.toLowerCase().includes(search.toLowerCase()) ||
    task.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground mt-1">
            Manage and track mission objectives
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Task
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="text-2xl font-mono font-bold">{stats?.total || 0}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Pending</p>
          <p className="text-2xl font-mono font-bold text-amber-400">{stats?.pending || 0}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">In Progress</p>
          <p className="text-2xl font-mono font-bold text-blue-400">{stats?.inProgress || 0}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Critical</p>
          <p className="text-2xl font-mono font-bold text-red-400">{stats?.critical || 0}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex items-center gap-2 bg-card border border-border rounded-lg p-1">
          {statusFilters.map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`
                px-4 py-2 rounded-md text-sm font-medium transition-colors
                ${filter === status
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }
              `}
            >
              {status === "all" ? "All" : status.replace("_", " ")}
            </button>
          ))}
        </div>
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Tasks List */}
      <Card padding="none">
        <div className="divide-y divide-border">
          {filteredTasks?.map((task) => (
            <TaskRow key={task._id} task={task} onDelete={() => deleteTask({ id: task._id })} />
          ))}
          {(!filteredTasks || filteredTasks.length === 0) && (
            <div className="p-12 text-center">
              <p className="text-muted-foreground">No tasks found</p>
            </div>
          )}
        </div>
      </Card>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateTaskModal
          onClose={() => setShowCreateModal(false)}
          onCreate={async (data) => {
            await createTask(data);
            setShowCreateModal(false);
          }}
        />
      )}
    </div>
  );
}

function TaskRow({ task, onDelete }: { task: Task; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold truncate">{task.title}</h3>
          <TaskPriorityBadge priority={task.priority} />
        </div>
        {task.description && (
          <p className="text-sm text-muted-foreground mt-1 truncate">{task.description}</p>
        )}
        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
          {task.assignedTo && <span>Assigned to {task.assignedTo}</span>}
          {task.dueDate && (
            <span>Due {new Date(task.dueDate).toLocaleDateString()}</span>
          )}
          {task.tags && task.tags.length > 0 && (
            <div className="flex gap-1">
              {task.tags.map((tag) => (
                <span key={tag} className="text-xs px-2 py-0.5 bg-muted rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 ml-4">
        <TaskStatusBadge status={task.status} />
        <button
          onClick={onDelete}
          className="p-2 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function CreateTaskModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: any) => Promise<void>;
}) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    priority: "medium" as TaskPriority,
    status: "pending" as TaskStatus,
    assignedTo: "",
    tags: [] as string[],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-4">Create New Task</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Priority</label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value as TaskPriority })}
                className="w-full px-3 py-2 bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Assigned To</label>
              <input
                type="text"
                value={formData.assignedTo}
                onChange={(e) => setFormData({ ...formData, assignedTo: e.target.value })}
                placeholder="@agent"
                className="w-full px-3 py-2 bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit">Create Task</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
