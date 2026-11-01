import { getPool } from "../db";
export async function videoUsage(userId:string|null,beforeRoom:string|null) {
    const filter="($1::uuid is null or r.user_id=$1)";
    const [summary,rooms]=await Promise.all([
        getPool().query("select count(*)::int participant_sessions,coalesce(sum(p.duration_ms),0)::text reported_duration_ms,count(*) filter(where r.rate_micros is null)::int unknown_rates,count(*) filter(where p.anomaly)::int anomalies,sum(ceil(p.duration_ms::numeric*r.rate_micros/60000))::text estimated_cost_micros from private.daily_participant_usage p join private.daily_room_usage r on r.room_name=p.room_name where "+filter+" and p.joined_at>=date_trunc('month',now())",[userId]),
        getPool().query("select r.room_name,r.booking_id,r.user_id,r.starts_at,r.expires_at,r.last_meeting_ended_at,r.rate_micros,count(p.session_id)::int reported_sessions,coalesce(sum(p.duration_ms),0)::text reported_duration_ms,count(*) filter(where p.anomaly)::int anomalies from private.daily_room_usage r left join private.daily_participant_usage p on p.room_name=r.room_name where "+filter+" and ($2::text is null or r.room_name<$2) group by r.room_name order by r.room_name desc limit 101",[userId,beforeRoom])
    ]);
    return {
        source:"daily_signed_participant_events",
        complete:false,
        coverage:"Reported participant-left events only. Missing or active sessions are not included; costs are estimates at the recorded rate, not provider invoices. Spending reservations remain in force.",
        period:"current_calendar_month",
        summary:summary.rows[0],
        rooms:rooms.rows.slice(0,100),
        nextCursor:rooms.rows.length>100?rooms.rows[99].room_name:null
    };
}
