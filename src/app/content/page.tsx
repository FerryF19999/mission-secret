'use client';

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export default function ContentPage() {
  const content = useQuery(api.contentItems.getAll, {});
  const contentLoading = content === undefined;

  if (contentLoading) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-6">📝 Content</h1>
        <div className="text-zinc-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">📝 Content Pipeline</h1>
      
      {(!content || content.length === 0) ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
          <p>No content yet. Content items will appear here when created.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {content.map((item: any) => (
            <div key={item._id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-white">{item.title}</h3>
                <span className="px-2 py-0.5 bg-zinc-800 rounded text-xs">{item.status}</span>
              </div>
              {item.description && (
                <p className="text-zinc-400 text-sm">{item.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
