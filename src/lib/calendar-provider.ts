export type CalendarBusyPeriod = { start: string; end: string };
export type CalendarConnectionState = "connected" | "reconnect_required";
export type ExternalCalendarEvent = {
  id: string;title: string;starts_at: string;ends_at: string;
  allDay?: boolean;source: string;readOnly: true;
};
export interface CalendarProvider {
  busy(userId: string, accountId: string, start: string, end: string): Promise<CalendarBusyPeriod[]>;
  events(userId: string, accountId: string, start: string, end: string): Promise<ExternalCalendarEvent[]>;
  disconnect(userId: string, accountId: string): Promise<void>;
}
