begin;
alter table private.waitlist_offers add column recipient_email text;
alter table private.waitlist_offers add column recipient_name text;
-- Historical offers did not snapshot their recipient. Expire them instead of guessing identity.
update private.waitlist_offers set state='expired' where state='offered' and recipient_email is null;
update private.appointment_waitlists w set state='waiting' where state='offered' and not exists(select 1 from private.waitlist_offers o where o.waitlist_id=w.id and o.state='offered');
commit;
