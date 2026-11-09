"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@/hooks/useTranslation";

interface AgentProfileView {
  id: string;
  displayName: string;
  description: string;
  orchestrator: string;
  strategyId: string;
  source?: string;
  created_at?: string;
}

const ORCHESTRATOR_LABELS: Record<string, string> = {
  single: "Single Agent",
  "multi-role": "Multi-Role Team",
  workflow: "Workflow Engine",
  delegate: "Remote Delegate",
};

export function ProfilesPanel() {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<AgentProfileView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newOrchestrator, setNewOrchestrator] = useState("single");
  const [newStrategyId, setNewStrategyId] = useState("react-loop");
  const [creating, setCreating] = useState(false);

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/profiles");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProfiles(data.profiles || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profiles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/agents/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: newName.trim(),
          description: newDescription.trim(),
          orchestrator: newOrchestrator,
          strategyId: newStrategyId,
          toolProviderIds: [],
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setNewName("");
      setNewDescription("");
      setNewOrchestrator("single");
      setNewStrategyId("react-loop");
      setShowCreate(false);
      await fetchProfiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create profile");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/agents/profiles/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchProfiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete profile");
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="h-4 w-96 bg-muted rounded" />
          <div className="h-32 w-full bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            {t("settings.profiles" as never) || "Agent Profiles"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure custom agent execution profiles with different orchestration modes, tools, and strategies.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          New Profile
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg bg-card border border-border/50 p-5 space-y-4">
          <h3 className="text-sm font-medium">Create Agent Profile</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Code Reviewer"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Orchestration Mode</label>
              <select
                value={newOrchestrator}
                onChange={(e) => setNewOrchestrator(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="single">Single Agent</option>
                <option value="multi-role">Multi-Role Team</option>
                <option value="workflow">Workflow Engine</option>
                <option value="delegate">Remote Delegate</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Description</label>
              <input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What this agent does..."
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Execution Strategy</label>
              <select
                value={newStrategyId}
                onChange={(e) => setNewStrategyId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="react-loop">ReAct Loop</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Profile list */}
      {profiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No agent profiles yet. Create one to customize how agents execute tasks.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            You can also add a <code className="bg-muted px-1 py-0.5 rounded">.codepilot/agents.json</code> file to your project root.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="rounded-lg bg-card border border-border/50 p-5 flex items-center justify-between group"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{profile.displayName}</span>
                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {ORCHESTRATOR_LABELS[profile.orchestrator] || profile.orchestrator}
                  </span>
                  {profile.source && profile.source !== "user" && (
                    <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600">
                      {profile.source}
                    </span>
                  )}
                </div>
                {profile.description && (
                  <p className="text-xs text-muted-foreground">{profile.description}</p>
                )}
                <p className="text-[11px] text-muted-foreground/60">
                  Strategy: {profile.strategyId} · ID: {profile.id}
                </p>
              </div>
              {profile.source !== "builtin" && profile.source !== "project" && (
                <button
                  onClick={() => handleDelete(profile.id)}
                  className="opacity-0 group-hover:opacity-100 rounded-md p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                  title="Delete profile"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 4h10M5 4V2h4v2M3 4l.5 8h5l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
