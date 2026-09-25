-- NEIS Circle v29 — normalize known legacy branch names to the current list.
begin;

update public.profiles
set
  branch=case trim(branch)
    when 'Sadat Branch' then 'El-Sadat'
    when 'Sadat' then 'El-Sadat'
    when 'El Sadat' then 'El-Sadat'
    when 'El-Sadat Branch' then 'El-Sadat'
    when 'El Shorouk Branch' then 'El-Shorouk'
    when 'El Shorouk' then 'El-Shorouk'
    when 'El-Shorouk Branch' then 'El-Shorouk'
    when 'El Obour Branch' then 'El-Obour'
    when 'El Obour' then 'El-Obour'
    when 'Obour Branch' then 'El-Obour'
    when 'El-Obour Branch' then 'El-Obour'
    when '6th October' then '6th of October'
    when '6 October' then '6th of October'
    when '6th of October Branch' then '6th of October'
    when 'Sheikh Zayed Branch' then 'Sheikh Zayed'
    when 'Port Said Branch' then 'Port Said'
    when 'New Damietta Branch' then 'New Damietta'
    when 'Minya Branch' then 'Minya'
    when 'New Assiut Branch' then 'New Assiut'
    when 'Qena Branch' then 'Qena'
    when 'New Tiba - Luxor' then 'New Tiba – Luxor'
    when 'New Aswan Branch' then 'New Aswan'
    when '10th Ramadan' then '10th of Ramadan'
    when '10th of Ramadan Branch' then '10th of Ramadan'
    when 'New Administrative Capital Branch' then 'New Administrative Capital'
    when 'Suez Branch' then 'Suez'
    when 'Sharm El Sheikh' then 'Sharm El-Sheikh'
    when 'Luxor Branch' then 'Luxor'
    else branch
  end,
  campus=case trim(campus)
    when 'Sadat Branch' then 'El-Sadat'
    when 'Sadat' then 'El-Sadat'
    when 'El Sadat' then 'El-Sadat'
    when 'El-Sadat Branch' then 'El-Sadat'
    when 'El Shorouk Branch' then 'El-Shorouk'
    when 'El Shorouk' then 'El-Shorouk'
    when 'El-Shorouk Branch' then 'El-Shorouk'
    when 'El Obour Branch' then 'El-Obour'
    when 'El Obour' then 'El-Obour'
    when 'Obour Branch' then 'El-Obour'
    when 'El-Obour Branch' then 'El-Obour'
    when '6th October' then '6th of October'
    when '6 October' then '6th of October'
    when '6th of October Branch' then '6th of October'
    when 'Sheikh Zayed Branch' then 'Sheikh Zayed'
    when 'Port Said Branch' then 'Port Said'
    when 'New Damietta Branch' then 'New Damietta'
    when 'Minya Branch' then 'Minya'
    when 'New Assiut Branch' then 'New Assiut'
    when 'Qena Branch' then 'Qena'
    when 'New Tiba - Luxor' then 'New Tiba – Luxor'
    when 'New Aswan Branch' then 'New Aswan'
    when '10th Ramadan' then '10th of Ramadan'
    when '10th of Ramadan Branch' then '10th of Ramadan'
    when 'New Administrative Capital Branch' then 'New Administrative Capital'
    when 'Suez Branch' then 'Suez'
    when 'Sharm El Sheikh' then 'Sharm El-Sheikh'
    when 'Luxor Branch' then 'Luxor'
    else campus
  end
where trim(coalesce(branch,'')) in (
  'Sadat Branch','Sadat','El Sadat','El-Sadat Branch','El Shorouk Branch','El Shorouk','El-Shorouk Branch',
  'El Obour Branch','El Obour','Obour Branch','El-Obour Branch','6th October','6 October','6th of October Branch',
  'Sheikh Zayed Branch','Port Said Branch','New Damietta Branch','Minya Branch','New Assiut Branch','Qena Branch',
  'New Tiba - Luxor','New Aswan Branch','10th Ramadan','10th of Ramadan Branch','New Administrative Capital Branch',
  'Suez Branch','Sharm El Sheikh','Luxor Branch'
)
or trim(coalesce(campus,'')) in (
  'Sadat Branch','Sadat','El Sadat','El-Sadat Branch','El Shorouk Branch','El Shorouk','El-Shorouk Branch',
  'El Obour Branch','El Obour','Obour Branch','El-Obour Branch','6th October','6 October','6th of October Branch',
  'Sheikh Zayed Branch','Port Said Branch','New Damietta Branch','Minya Branch','New Assiut Branch','Qena Branch',
  'New Tiba - Luxor','New Aswan Branch','10th Ramadan','10th of Ramadan Branch','New Administrative Capital Branch',
  'Suez Branch','Sharm El Sheikh','Luxor Branch'
);

commit;
select 'NEIS Circle v29 branch list ready' as result;
