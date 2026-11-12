ALTER TABLE public.contacts ADD COLUMN phone text NOT NULL DEFAULT '' CHECK(length(phone)<=40), ADD COLUMN address text NOT NULL DEFAULT '' CHECK(length(address)<=500);
ALTER TABLE private.delivery_jobs ADD COLUMN calendar_ciphertext text;
