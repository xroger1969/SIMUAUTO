const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {PGlite}=require('./db-runtime/node_modules/@electric-sql/pglite');

const database=join(__dirname,'../database');
const oldMigration=readFileSync(join(database,'20261006_comparador_history_stability.sql'),'utf8');
const oldFunction=oldMigration.slice(oldMigration.indexOf('create or replace function public.cap_save_analysis'),oldMigration.lastIndexOf('commit;'));
const migration=readFileSync(join(database,'20261022_comparador_idempotent_save.sql'),'utf8');
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const first='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Local, empty Postgres only. Synthetic session claims replace auth users;
// the production function and owner RLS execute without any rewritten SQL.
const setup=`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth,public to authenticated;
grant execute on function auth.uid() to authenticated;
create table public.cap_analyses(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid(),source_url text not null,
 status text not null default 'queued',vehicle jsonb not null default '{}',
 market jsonb not null default '{}',purchase jsonb not null default '{}',
 risks jsonb not null default '[]',reader jsonb not null default '{}',
 error_message text,source_snapshot jsonb not null default '{}',
 source_last_seen_at timestamptz,snapshot jsonb not null default '{}',
 updated_at timestamptz not null default now()
);
create table public.cap_revisions(
 id uuid primary key default gen_random_uuid(),user_id uuid not null default auth.uid(),
 analysis_id uuid not null references public.cap_analyses(id),snapshot jsonb not null,
 created_at timestamptz not null default now(),calculation_kind text not null default 'analysis',
 engine_version text,vehicle_title text,purchase_ceiling numeric,sale_likely numeric,
 sale_fast numeric,confidence_pct integer,comparables_used integer,input_signature text
);
create table public.cap_comparables(
 id uuid primary key default gen_random_uuid(),user_id uuid not null default auth.uid(),
 analysis_id uuid not null references public.cap_analyses(id),
 revision_id uuid references public.cap_revisions(id),source_url text,source_domain text,
 vehicle jsonb not null default '{}',similarity numeric,adjusted_price numeric,
 used_in_valuation boolean not null default false,exclusion_reason text
);
alter table public.cap_analyses enable row level security;
alter table public.cap_revisions enable row level security;
alter table public.cap_comparables enable row level security;
create policy cap_analyses_own_rows on public.cap_analyses for all to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy cap_revisions_owner on public.cap_revisions for all to authenticated
 using(user_id=(select auth.uid()))
 with check(user_id=(select auth.uid()) and exists(
  select 1 from public.cap_analyses a where a.id=analysis_id and a.user_id=(select auth.uid())
 ));
create policy cap_comparables_own_rows on public.cap_comparables for all to authenticated
 using(user_id=(select auth.uid()))
 with check(user_id=(select auth.uid()) and exists(
  select 1 from public.cap_analyses a where a.id=analysis_id and a.user_id=(select auth.uid())
 ));
grant select,insert,update,delete on public.cap_analyses,public.cap_revisions,public.cap_comparables to authenticated;
`;

test('save migration executes transactionally: lost acknowledgments do not duplicate or rewind history',async t=>{
 const db=new PGlite();
 t.after(()=>db.close());
 await db.exec(setup);
 await db.exec(oldFunction);
 await db.exec('grant execute on function public.cap_save_analysis(uuid,jsonb) to service_role;');
 await db.exec(migration);
 const security=(await db.query(`select prosecdef,
  has_function_privilege('authenticated',oid,'execute') as authenticated,
  has_function_privilege('service_role',oid,'execute') as service_role,
  has_function_privilege('anon',oid,'execute') as anon
  from pg_proc where oid='public.cap_save_analysis(uuid,jsonb)'::regprocedure`)).rows[0];
 assert.deepEqual(security,{prosecdef:false,authenticated:true,service_role:true,anon:false});

 await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${owner}',true);`);
 await db.query('insert into public.cap_analyses(id,source_url) values ($1,$2),($3,$4)',[first,'https://example.test/first',second,'https://example.test/second']);
 const payload={calculation_kind:'analysis',reader:{page:{title:'Synthetic car'}},research:{input_signature:'test-only',risk_flags:[]},result:{
  engine_version:'test',subject:{make:'Tesla',model:'Model Y',trim:'Long Range AWD'},
  purchase:{effectiveCeiling:25000},market:{saleLikely:31000,saleFast:30000,confidencePct:40,comparablesUsed:1},
  comparables:[{url:'https://example.test/used',source_domain:'example.test',similarity:80,adjustedPrice:31500}],
  excluded:[{comp:{url:'https://example.test/excluded',source_domain:'example.test'},reason:'Different fuel'}]
 }};
 const save=async(id,snapshot)=>(await db.query('select public.cap_save_analysis($1,$2::jsonb) as id',[id,JSON.stringify(snapshot)])).rows[0].id;
 const counts=async()=>(await db.query('select (select count(*)::int from public.cap_revisions) as revisions,(select count(*)::int from public.cap_comparables) as comparables')).rows[0];
 const failed=async(fn,message)=>{
  await db.exec('savepoint expected_error;');
  await assert.rejects(fn,message);
  await db.exec('rollback to savepoint expected_error; release savepoint expected_error;');
 };

 const original=await save(first,payload);
 assert.equal(await save(first,JSON.parse(JSON.stringify(payload))),original);
 assert.deepEqual(await counts(),{revisions:1,comparables:2});
 const firstRevision=(await db.query('select calculation_kind,vehicle_title,purchase_ceiling::text,sale_likely::text,input_signature from public.cap_revisions where id=$1',[original])).rows[0];
 assert.deepEqual(firstRevision,{calculation_kind:'analysis',vehicle_title:'Tesla Model Y Long Range AWD',purchase_ceiling:'25000',sale_likely:'31000',input_signature:'test-only'});

 const changed=JSON.parse(JSON.stringify(payload));changed.result.market.saleLikely=32000;
 const newer=await save(first,changed);
 assert.notEqual(newer,original);
 assert.equal(await save(first,payload),original);
 assert.deepEqual((await db.query('select snapshot from public.cap_analyses where id=$1',[first])).rows[0].snapshot,changed);
 assert.deepEqual(await counts(),{revisions:2,comparables:4});

 const metadataOnly={...changed,calculation_kind:'refinement'};
 assert.notEqual(await save(first,metadataOnly),newer);
 assert.notEqual(await save(second,payload),original);
 assert.deepEqual(await counts(),{revisions:4,comparables:8});

 await failed(()=>save(first,{result:null}),/Invalid snapshot/);
 const malformed=JSON.parse(JSON.stringify(changed));malformed.result.comparables[0].similarity='invalid';
 await failed(()=>save(first,malformed),/invalid input syntax/);
 assert.deepEqual(await counts(),{revisions:4,comparables:8});
 assert.deepEqual((await db.query('select snapshot from public.cap_analyses where id=$1',[first])).rows[0].snapshot,metadataOnly);

 await db.exec(`select set_config('request.jwt.claim.sub','${other}',true);`);
 await failed(()=>save(first,payload),/Analysis not found/);
 assert.deepEqual(await counts(),{revisions:0,comparables:0});
 await db.exec("select set_config('request.jwt.claim.sub','',true);");
 await failed(()=>save(first,payload),/Access denied/);
 await db.exec('rollback;');
 assert.deepEqual(await counts(),{revisions:0,comparables:0});
});
