import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const hash = (s) => createHash("sha256").update(s).digest("hex");
test("SQL migration, access restrictions, atomic ticket use, event uniqueness and board consent", async () => {
  const pg = new PGlite();
  await pg.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);",
  );
  await pg.exec(await readFile("supabase/schema.sql", "utf8"));
  // Migration is repeatable, and authenticated users have no direct table or RPC access.
  await pg.exec(await readFile("supabase/schema.sql", "utf8"));
  const permissions = await pg.query(
    "select has_table_privilege('authenticated','public.tickets','select') as table_access,has_function_privilege('anon','public.claim_ticket(uuid,text)','execute') as rpc_access",
  );
  assert.deepEqual(permissions.rows[0], {
    table_access: false,
    rpc_access: false,
  });
  const a = randomUUID(),
    b = randomUUID();
  await pg.query("insert into auth.users values($1),($2)", [a, b]);
  await pg.query(
    "insert into profiles(id,name,public_name) values($1,$3,true),($2,$4,false)",
    [a, b, "Test Öğrenci", "Gizli Öğrenci"],
  );
  for (let i = 1; i <= 5; i++) {
    const codes = [`code-${i}-a`, `code-${i}-b`];
    await pg.query("select create_ticket_batch($1,$2,$3,$4::jsonb)", [
      randomUUID(),
      `event-${i}`,
      `Etkinlik ${i}`,
      JSON.stringify(codes),
    ]);
    const r = await pg.query("select claim_ticket($1,$2) result", [
      a,
      hash(codes[0]),
    ]);
    assert.equal(r.rows[0].result.ok, true);
    const again = await pg.query("select claim_ticket($1,$2) result", [
      b,
      hash(codes[0]),
    ]);
    assert.match(again.rows[0].result.error, /kullanılmış/);
    const duplicate = await pg.query("select claim_ticket($1,$2) result", [
      a,
      hash(codes[1]),
    ]);
    assert.match(duplicate.rows[0].result.error, /zaten/);
  }
  const board = await pg.query("select * from badge_board()");
  assert.equal(board.rows.length, 1);
  assert.equal(Number(board.rows[0].total), 5);
  await pg.query("update profiles set public_name=false where id=$1", [a]);
  assert.equal((await pg.query("select * from badge_board()")).rows.length, 0);
  const missing = await pg.query("select claim_ticket($1,$2) result", [
    a,
    hash("unknown"),
  ]);
  assert.match(missing.rows[0].result.error, /geçersiz/);
  const id = randomUUID();
  await pg.query("select create_ticket_batch($1,$2,$3,$4::jsonb)", [
    id,
    "event-revoked",
    "İptal",
    JSON.stringify(["revoked-code"]),
  ]);
  await pg.query("update tickets set revoked=true where batch_id=$1", [id]);
  assert.match(
    (
      await pg.query("select claim_ticket($1,$2) result", [
        a,
        hash("revoked-code"),
      ])
    ).rows[0].result.error,
    /iptal/,
  );
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await pg.query("select check_rate($1,5,3600) ok", ["test-key"])).rows[0]
        .ok,
      true,
    );
  assert.equal(
    (await pg.query("select check_rate($1,5,3600) ok", ["test-key"])).rows[0]
      .ok,
    false,
  );
  await pg.close();
});
