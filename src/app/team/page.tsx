"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { AgentStatusBadge } from "@/components/AgentStatusBadge";
import { Agent, AgentStatus } from "@/types";
import { Plus, Bot, Zap, Settings, Activity } from "lucide-react";

const statusOptions: AgentStatus[] = ["active", "idle", "busy", "offline"];

export default function TeamPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const agents = useQuery(api.agents.getAll);
  const stats = useQuery(api.agents.getStats);
  const updateStatus = useMutation(api.agents.setStatus);

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team</h1>
          <p className="text-muted-foreground mt-1">
            Manage your AI agent workforce
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Agent
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Total Agents</p>
          <p className="text-2xl font-mono font-bold">{stats?.total || 0}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Active</p>
          <p className="text-2xl font-mono font-bold text-emerald-400">{stats?.active || 0}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Busy</p>
          <p className="text-2xl font-mono font-bold text-red-400">{stats?.busy || 0}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Idle</p>
          <p className="text-2xl font-mono font-bold text-amber-400">{stats?.idle || 0}</p>
        </div>
      </div>

      {/* Agents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {agents?.map((agent) => (
          <AgentCard key={agent._id} agent={agent} onUpdateStatus={(status) => updateStatus({ id: agent._id, status })} />
        ))}
        {(!agents || agents.length === 0) && (
          <div className="col-span-full text-center py-12">
            <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No agents yet. Add your first agent!</p>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateAgentModal onClose={() => setShowCreateModal(false)} />
      )}
    </div>
  );
}

function AgentCard({ agent, onUpdateStatus }: { agent: Agent; onUpdateStatus: (status: AgentStatus) => void }) {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4">
        <select
          value={agent.status}
          onChange={(e) => onUpdateStatus(e.target.value as AgentStatus)}
          className="text-xs bg-muted border border-border rounded px-2 py-1 focus:outline-none"
        >
          {statusOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold">
            {agent.name.charAt(0)}
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold">{agent.name}</h3>
            <p className="text-sm text-muted-foreground font-mono">{agent.handle}</p>
            <p className="text-sm text-muted-foreground mt-1">{agent.role}</p>
          </div>
        </div>

        <div className="mt-4">
          <AgentStatusBadge status={agent.status} />
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium mb-2">Capabilities</p>
          <div className="flex flex-wrap gap-2">
            {agent.capabilities.map((cap) => (
              <span
                key={cap}
                className="text-xs px-2 py-1 bg-muted rounded-full text-muted-foreground"
              >
                {cap.replace("_", " ")}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Activity className="w-4 h-4" />
            Last active {new Date(agent.lastActive).toLocaleTimeString()}
          </span>
        </div>
      </div>
    </Card>
  );
}

function CreateAgentModal({ onClose }: { onClose: () => void }) {
  const createAgent = useMutation(api.agents.create);
  const [formData, setFormData] = useState({
    name: "",
    handle: "",
    role: "",
    capabilities: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createAgent({
      ...formData,
      handle: formData.handle.startsWith("@") ? formData.handle : `@${formData.handle}`,
      capabilities: formData.capabilities.split(",").map(c => c.trim()).filter(Boolean),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-4">Add New Agent</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Handle</label>
            <input
              type="text"
              required
              value={formData.handle}
              onChange={(e) => setFormData({ ...formData, handle: e.target.value })}
              placeholder="@agentname"
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Role</label>
            <input
              type="text"
              required
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              placeholder="e.g. Executive Assistant"
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Capabilities (comma-separated)</label>
            <input
              type="text"
              value={formData.capabilities}
              onChange={(e) => setFormData({ ...formData, capabilities: e.target.value })}
              placeholder="research, coding, writing"
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add Agent</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
