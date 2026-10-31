"use client";
import { useEffect, useState } from "react";
import { Alert, Badge, Card, Skeleton } from "./ui";

type Status = { available: true; name: string } | { available: false; reason: string };
// Honest status for built-in video: shown as blocked until a provider is actually connected.
export function VideoMeetings() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    fetch("/api/video", { cache: "no-store" })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ available: false, reason: "Video status couldn’t be checked." }));
  }, []);
  return (
    <Card
      title="Video meetings"
      description="Add a meeting link to any appointment type’s location — Zoom, Google Meet, Teams and others work today."
      actions={status && <Badge tone={status.available ? "success" : "neutral"}>{status.available ? "Connected" : "Not available yet"}</Badge>}
    >
      {!status ? (
        <Skeleton rows={1} />
      ) : status.available ? (
        <Alert tone="success" title={`${status.name} is connected`}>
          New appointments can include an automatically created meeting link.
        </Alert>
      ) : (
        <Alert tone="info" title="Built-in video isn’t available yet">
          {status.reason}
        </Alert>
      )}
    </Card>
  );
}
