begin;
alter table private.signature_envelopes add column signing_mode text not null default 'parallel' check(signing_mode in ('parallel','sequential'));
alter table private.signature_envelopes add column email_delivery_enabled boolean not null default false;
alter table private.signature_envelopes add column completed_pdf bytea;
alter table private.signature_envelopes add column completed_pdf_hash text;
alter table private.signature_recipients add column signing_order integer not null default 1 check(signing_order between 1 and 10);
alter table private.signature_recipients add column signature_image bytea check(octet_length(signature_image)<=20000);
alter table private.signature_recipients add column signature_image_hash text;
create index signature_recipients_order_idx on private.signature_recipients(envelope_id,signing_order,status);
-- Completed evidence cannot be altered by an accidental future update.
create function private.protect_completed_evidence() returns trigger language plpgsql set search_path='' as $$
begin
 if old.completed_pdf is not null and (new.completed_pdf is distinct from old.completed_pdf or new.completed_pdf_hash is distinct from old.completed_pdf_hash or new.content_hash is distinct from old.content_hash or new.fields is distinct from old.fields or new.pdf is distinct from old.pdf) then
  raise exception 'completed_evidence_immutable';
 end if;
 return new;
end $$;
create trigger protect_completed_evidence before update on private.signature_envelopes for each row execute function private.protect_completed_evidence();
revoke all on function private.protect_completed_evidence() from public,anon,authenticated;
commit;
