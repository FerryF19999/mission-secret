'use client';

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export default function MemoryPage() {
  const memories = useQuery(api.memories.getAll, {});
  const memoriesLoading = memories === undefined;

  if (memoriesLoading) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-6">🧠 Memory</h1>
        <div className="text-zinc-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">🧠 Memory</h1>
      
      {(!memories || memories.length === 0) ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
          <p>No memories yet. Memories will appear here when agents complete tasks.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {memories.map((mem: any) => (
            <div key={mem._id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-zinc-500">
                  {new Date(mem.createdAt).toLocaleString()}
                </span>
                <span className="px-2 py-0.5 bg-zinc-800 rounded text-xs">{mem.type}</span>
              </div>
              <p className="text-zinc-300">{mem.content?.substring(0, 500)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
