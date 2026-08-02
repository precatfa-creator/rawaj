-- Many Libyan stores have no website at all — their only public presence is a
-- Facebook page, so it belongs on the store record next to the image.
--
-- No URL check constraint: the field is optional and operators paste whatever
-- the Facebook app gave them (m.facebook.com, fb.me short links, profile.php
-- ids). A rejected paste is a worse failure here than a slightly untidy value.

alter table public.stores
  add column if not exists facebook_page text not null default '';
