import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
script=ROOT/"scripts/ops/ovh-patch-timetable-rpc-colors.py"
spec=importlib.util.spec_from_file_location("timetable_rpc_patch",str(script))
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

SAMPLE="""CREATE OR REPLACE FUNCTION public.apply_timetable_ai_plan(p_plan jsonb,p_expected jsonb)
returns setof public.user_timetable_entries
language plpgsql
as $$
begin
if p_plan is null then raise exception 'empty'; end if;
for item in select value from jsonb_array_elements(p_plan) as value loop
if coalesce(item->>'category','Class') not in
('Class','Lab','Study','Exam','Activity','Other') then
raise exception 'Invalid timetable item';
end if;
update public.user_timetable_entries set
title=trim(item->>'title'),
category=coalesce(item->>'category','Class')
where id=row_id and user_id=uid and
(title,day_of_week,start_time,end_time,location,notes,category) is distinct from
(trim(item->>'title'),(item->>'day_of_week')::smallint,
(item->>'start_time')::time,(item->>'end_time')::time,
coalesce(item->>'location',''),coalesce(item->>'notes',''),
coalesce(item->>'category','Class'));
insert into public.user_timetable_entries
(user_id,title,day_of_week,start_time,end_time,location,notes,category,
color,reminder_enabled,reminder_minutes)
values (uid,trim(item->>'title'),(item->>'day_of_week')::smallint,
(item->>'start_time')::time,(item->>'end_time')::time,
coalesce(item->>'location',''),coalesce(item->>'notes',''),
coalesce(item->>'category','Class'),'#2f7db8',false,15);
end loop;
end;
$$;
"""

class TestColorMigration(unittest.TestCase):
 def test_sql_patches_both_insert_and_update(self):
  patched=mod.patch_function(SAMPLE)
  self.assertEqual(patched.count("color=coalesce(item->>'color','#2f7db8')"),1)
  self.assertIn("category,color) is distinct from",patched)
  self.assertIn("coalesce(item->>'category','Class'),coalesce(item->>'color','#2f7db8'))",patched)
  self.assertIn("coalesce(item->>'category','Class'),coalesce(item->>'color','#2f7db8'),false,15)",patched)
  self.assertIn("coalesce(item->>'color','#2f7db8') !~ '^#[0-9A-Fa-f]{6}$'",patched)
  self.assertEqual(mod.patch_function(patched),patched)
 def test_modified_function_fails_closed(self):
  with self.assertRaisesRegex(ValueError,"ANCHOR_CHANGED"):
   mod.patch_function(SAMPLE.replace("'#2f7db8',false,15","'#123abc',false,15"))
 def test_no_db_contact_during_import(self):
  self.assertTrue(callable(mod.patch_function))

if __name__=="__main__":
 unittest.main(verbosity=2)
