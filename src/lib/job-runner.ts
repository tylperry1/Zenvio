import { drainSmsOutbox } from "./launch/sms-outbox";
import { randomUUID } from "node:crypto";
import { getPool } from "./db";
import { materializeBookingNotifications, mailReady } from "./mail";
import { drainCalendarCleanup,runGoogleJobs } from "./google-calendar";
import {runMicrosoftJobs} from "./microsoft-calendar";
import { scheduleWorkflows } from "./workflows";
import {
  materializeReminders,
  drainDeliveries,
  purgeExpiredDeliverySecrets,
} from "./lifecycle";
export async function runnerStatus() {
  const state =
    (
      await getPool().query(
        "SELECT last_started_at,last_success_at,last_error FROM private.job_runner_state WHERE id='scheduled'",
      )
    ).rows[0] || {};
  const configured =
    process.env.JOB_SCHEDULER_PROVIDER === "github-actions" ||
    process.env.JOB_SCHEDULER_CONFIGURED === "true";
  return {
    configured,
    healthy:
      configured &&
      !state.last_error &&
      !!state.last_success_at &&
      Date.now() - new Date(state.last_success_at).getTime() < 20 * 60000,
    lastStarted: state.last_started_at || null,
    lastSuccess: state.last_success_at || null,
    lastError: state.last_error || null,
    provider:
      process.env.JOB_SCHEDULER_PROVIDER === "github-actions"
        ? "GitHub Actions"
        : configured
          ? "External scheduler"
          : null,
  };
}
export async function processScheduledJobs() {
  const id = randomUUID(),
    pool = getPool();
  const lease = await pool.query(
    "INSERT INTO private.job_runner_state(id,claim_id,locked_until,last_started_at) VALUES('scheduled',$1,now()+interval '5 minutes',now()) ON CONFLICT(id) DO UPDATE SET claim_id=$1,locked_until=now()+interval '5 minutes',last_started_at=now() WHERE private.job_runner_state.locked_until IS NULL OR private.job_runner_state.locked_until<=now() RETURNING id",
    [id],
  );
  if (!lease.rowCount)
    return { busy: true, configured: await mailReady(), sent: 0 };
  try {
    await drainSmsOutbox();
    await drainCalendarCleanup();
    await Promise.all([runGoogleJobs(undefined,5),runMicrosoftJobs(undefined,5)]);
    await purgeExpiredDeliverySecrets();
    await materializeBookingNotifications();
    await materializeReminders();
    await scheduleWorkflows();
    const result = await drainDeliveries(undefined, 20);
    if (!result.configured) throw Error("mail_unconfigured");
    await pool.query(
      "UPDATE private.job_runner_state SET locked_until=NULL,last_success_at=now(),last_error=NULL WHERE id='scheduled' AND claim_id=$1",
      [id],
    );
    return { busy: false, ...result };
  } catch (e) {
    await pool.query(
      "UPDATE private.job_runner_state SET locked_until=NULL,last_error=$2 WHERE id='scheduled' AND claim_id=$1",
      [
        id,
        e instanceof Error && e.message === "mail_unconfigured"
          ? "Email delivery is not configured."
          : "Scheduled processing failed. Check the delivery queue and retry.",
      ],
    );
    throw e;
  }
}
