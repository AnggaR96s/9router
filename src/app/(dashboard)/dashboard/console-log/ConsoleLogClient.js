"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const LOG_LEVEL_COLORS = {
  LOG: "text-green-400",
  INFO: "text-blue-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
  DEBUG: "text-purple-400",
};

function colorLine(line) {
  const match = line.match(/\[(\w+)\]/g);
  const levelTag = match ? match[1]?.replace(/\[|\]/g, "") : null;
  const color = LOG_LEVEL_COLORS[levelTag] || "text-green-400";
  return <span className={color}>{line}</span>;
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [showJumpDown, setShowJumpDown] = useState(false);
  const logRef = useRef(null);

  // How close to the bottom counts as "at the bottom" (px)
  const STICK_THRESHOLD_PX = 60;

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      // UI cleared via SSE "clear" event
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
      } else if (msg.type === "line") {
        setLogs((prev) => {
          const next = [...prev, msg.line];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "lines") {
        setLogs((prev) => {
          const next = [...prev, ...msg.lines];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  // Track scroll position: only auto-stick when the user is already at/near
  // the bottom. Scrolling up pauses auto-scroll so new logs don't yank the
  // view back down while reading history.
  const handleScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    setStickToBottom(atBottom);
    setShowJumpDown(!atBottom);
  };

  const jumpToBottom = () => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setStickToBottom(true);
    setShowJumpDown(false);
  };

  // Auto-scroll to bottom on new logs — only if the user is already at bottom
  useEffect(() => {
    if (!logRef.current || !stickToBottom) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs, stickToBottom]);

  return (
    <div className="">
      <Card>
        <div className="flex items-center justify-end px-4 pt-3 pb-2">
          <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>
            Clear
          </Button>
        </div>
        <div className="relative">
          <div
            ref={logRef}
            onScroll={handleScroll}
            className="bg-black rounded-b-lg p-4 text-xs font-mono h-[calc(100vh-220px)] overflow-y-auto"
          >
            {logs.length === 0 ? (
              <span className="text-text-muted">No console logs yet.</span>
            ) : (
              <div className="space-y-0.5">
                {logs.map((line, i) => (
                  <div key={i}>{colorLine(line)}</div>
                ))}
              </div>
            )}
          </div>
          {showJumpDown && (
            <button
              onClick={jumpToBottom}
              className="absolute bottom-4 right-4 flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-lg transition-colors hover:bg-primary/90"
              title="Jump to latest logs"
            >
              <span className="material-symbols-outlined text-sm">south</span>
              Latest
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
