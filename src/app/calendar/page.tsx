'use client';

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export default function CalendarPage() {
  const events = useQuery(api.scheduledEvents.getAll, {});
  const eventsLoading = events === undefined;

  if (eventsLoading) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-6">📅 Calendar</h1>
        <div className="text-zinc-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">📅 Calendar</h1>
      
      {(!events || events.length === 0) ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
          <p>No scheduled events yet. Events will appear here when cron jobs run.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {events.map((event: any) => (
            <div key={event._id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-white">{event.title}</h3>
                {event.color && (
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: event.color }}
                  />
                )}
              </div>
              {event.description && (
                <p className="text-zinc-400 text-sm">{event.description}</p>
              )}
              <div className="mt-2 text-xs text-zinc-500">
                {event.startTime && new Date(event.startTime).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
