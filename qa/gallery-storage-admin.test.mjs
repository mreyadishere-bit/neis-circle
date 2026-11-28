import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile('supabase/migrations/20261128150000_main_admin_gallery_storage.sql', 'utf8');
const ui = await readFile('scripts/gallery-storage-admin-v1.js', 'utf8');
const deploy = await readFile('scripts/ops/ovh-deploy-main-admin-gallery-storage.py', 'utf8');

for (const expected of [
  'create or replace function public.main_admin_gallery_storage()',
  'security definer',
  "auth.role() <> 'authenticated'",
  "u.id = '25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid",
  "lower(coalesce(u.email, '')) = 'mreyadishere@gmail.com'",
  "p.role = 'admin'",
  "o.bucket_id = 'community-media'",
  "o.name like '%/gallery/%'",
  "o.metadata->>'size'",
  'revoke all on function public.main_admin_gallery_storage()',
  'grant execute on function public.main_admin_gallery_storage()'
]) assert.ok(sql.toLowerCase().includes(expected.toLowerCase()), 'Missing SQL guard/measurement: '+expected);

for (const expected of [
  "sb.rpc('main_admin_gallery_storage')",
  'Total Gallery storage (Photograph + Art combined)',
  'neisGalleryStorageTotal',
  'neisGalleryStorageFiles',
  'unmeasured_object_count',
  '60 seconds',
  'isOwner()'
]) assert.ok(ui.includes(expected), 'Missing Gallery storage UI contract: '+expected);

assert.ok(deploy.includes('pg_dump'), 'Deployment must take a database backup first.');
assert.ok(deploy.includes('pg_restore'), 'Deployment must verify the database backup.');
assert.ok(deploy.includes('OTHER_SERVICES_AND_TABLES=UNCHANGED'));
assert.ok(deploy.includes('main_admin_gallery_storage'));
console.log('GALLERY_STORAGE_ADMIN_QA=PASS');
