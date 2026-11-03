-- NEIS Quiz Studio: isolated tables; existing flashcard data preserved for backward compatibility.
create table if not exists public.neis_quizzes(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (char_length(trim(title)) between 3 and 100),
 subject text not null default '',
 visibility text not null default 'public' check(visibility in ('public','private')),
 created_at timestamptz not null default now()
);
create table if not exists public.neis_quiz_questions(
 id uuid primary key default gen_random_uuid(),
 quiz_id uuid not null references public.neis_quizzes(id) on delete cascade,
 prompt text not null check(char_length(trim(prompt)) between 5 and 600),
 options jsonb not null check(jsonb_typeof(options)='array' and jsonb_array_length(options)=4),
 explanation text not null default '',
 sort_order integer not null default 0
);
create table if not exists public.neis_quiz_answers(
 question_id uuid primary key references public.neis_quiz_questions(id) on delete cascade,
 correct_index integer not null check(correct_index between 0 and 3)
);
create index if not exists neis_quiz_questions_quiz_idx on public.neis_quiz_questions(quiz_id,sort_order);
alter table public.neis_quizzes enable row level security;
alter table public.neis_quiz_questions enable row level security;
alter table public.neis_quiz_answers enable row level security;
drop policy if exists neis_quizzes_select on public.neis_quizzes;
create policy neis_quizzes_select on public.neis_quizzes for select to authenticated using (visibility='public' or owner_id=auth.uid());
drop policy if exists neis_quizzes_insert on public.neis_quizzes;
create policy neis_quizzes_insert on public.neis_quizzes for insert to authenticated with check(owner_id=auth.uid());
drop policy if exists neis_quizzes_update on public.neis_quizzes;
create policy neis_quizzes_update on public.neis_quizzes for update to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
drop policy if exists neis_quizzes_delete on public.neis_quizzes;
create policy neis_quizzes_delete on public.neis_quizzes for delete to authenticated using(owner_id=auth.uid());
drop policy if exists neis_quiz_questions_select on public.neis_quiz_questions;
create policy neis_quiz_questions_select on public.neis_quiz_questions for select to authenticated using(exists(select 1 from public.neis_quizzes q where q.id=quiz_id and (q.visibility='public' or q.owner_id=auth.uid())));
revoke all on public.neis_quiz_answers from anon,authenticated;
grant select,insert,update,delete on public.neis_quizzes to authenticated;
grant select on public.neis_quiz_questions to authenticated;

create or replace function public.neis_quiz_add_question(p_quiz uuid,p_prompt text,p_options jsonb,p_correct integer,p_explanation text default '')
returns uuid language plpgsql security definer set search_path=public as $$
declare qid uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.neis_quizzes where id=p_quiz and owner_id=auth.uid()) then raise exception 'quiz_owner_only';end if;
 if char_length(trim(coalesce(p_prompt,''))) not between 5 and 600 or jsonb_typeof(p_options)<>'array' or jsonb_array_length(p_options)<>4 or p_correct not between 0 and 3 then raise exception 'invalid_question';end if;
 if exists(select 1 from jsonb_array_elements(p_options) o where jsonb_typeof(o)<>'string' or length(trim(o #>> '{}')) not between 1 and 200) then raise exception 'invalid_options';end if;
 if (select count(*) from public.neis_quiz_questions where quiz_id=p_quiz)>=60 then raise exception 'quiz_limit_reached';end if;
 insert into public.neis_quiz_questions(quiz_id,prompt,options,explanation,sort_order)
 values(p_quiz,trim(p_prompt),p_options,left(coalesce(p_explanation,''),1000),(select count(*) from public.neis_quiz_questions where quiz_id=p_quiz))
 returning id into qid;
 insert into public.neis_quiz_answers(question_id,correct_index) values(qid,p_correct);
 return qid;
end;$$;

create or replace function public.neis_quiz_grade(p_question uuid,p_choice integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare correct_idx integer; explanation text;
begin
 if auth.uid() is null then raise exception 'login_required';end if;
 if p_choice not between 0 and 3 then raise exception 'invalid_choice';end if;
 select a.correct_index,q.explanation into correct_idx,explanation
 from public.neis_quiz_questions q join public.neis_quiz_answers a on a.question_id=q.id
 join public.neis_quizzes z on z.id=q.quiz_id
 where q.id=p_question and (z.visibility='public' or z.owner_id=auth.uid());
 if not found then raise exception 'question_unavailable';end if;
 return jsonb_build_object('correct_index',correct_idx,'is_correct',correct_idx=p_choice,'explanation',explanation);
end;$$;
revoke all on function public.neis_quiz_add_question(uuid,text,jsonb,integer,text),public.neis_quiz_grade(uuid,integer) from public;
grant execute on function public.neis_quiz_add_question(uuid,text,jsonb,integer,text),public.neis_quiz_grade(uuid,integer) to authenticated;
notify pgrst,'reload schema';
