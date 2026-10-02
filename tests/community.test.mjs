import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import handler from "../netlify/functions/community.mjs";
import { adminLogin } from "../netlify/lib/security.mjs";
test("community handler integrates with SQL: moderation, profiles, ticket claim and private contact data", async () => {
  const pg = new PGlite();
  await pg.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);",
  );
  await pg.exec(await readFile("supabase/schema.sql", "utf8"));
  process.env.SUPABASE_URL = "https://local-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.ADMIN_PASSWORD = "test-admin-only";
  const uid = randomUUID();
  await pg.query("insert into auth.users values($1)", [uid]);
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input),
      data = options.body ? JSON.parse(options.body) : {};
    if (url.pathname === "/auth/v1/user")
      return Response.json({
        id: uid,
        email: "private@example.test",
        email_confirmed_at: null,
      });
    assert.equal(options.headers.apikey, "test-service-key");
    const table = url.pathname.split("/").pop();
    if (url.pathname.includes("/rpc/")) {
      if (table === "check_rate")
        return Response.json(
          (
            await pg.query("select check_rate($1,$2,$3) value", [
              data.p_key,
              data.p_max,
              data.p_seconds,
            ])
          ).rows[0].value,
        );
      if (table === "claim_ticket")
        return Response.json(
          (
            await pg.query("select claim_ticket($1,$2) value", [
              data.p_user,
              data.p_hash,
            ])
          ).rows[0].value,
        );
      if (table === "badge_board")
        return Response.json(
          (await pg.query("select * from badge_board()")).rows.map((r) => ({
            ...r,
            total: Number(r.total),
          })),
        );
    }
    assert.ok(
      [
        "profiles",
        "attendance",
        "members",
        "submissions",
        "ticket_batches",
        "tickets",
      ].includes(table),
    );
    if (options.method === "POST") {
      const keys = Object.keys(data),
        values = Object.values(data);
      let sql = `insert into ${table}(${keys.join(",")}) values(${keys.map((_, i) => "$" + (i + 1)).join(",")})`;
      if (table === "profiles")
        sql +=
          " on conflict(id) do update set name=excluded.name,public_name=excluded.public_name";
      return Response.json((await pg.query(sql + " returning *", values)).rows);
    }
    const conditions = [],
      values = [];
    for (const [key, v] of url.searchParams) {
      if (v.startsWith("eq.")) {
        assert.ok(
          ["id", "kind", "status", "user_id", "batch_id"].includes(key),
        );
        values.push(v.slice(3));
        conditions.push(`${key}=$${values.length}`);
      }
    }
    const where = conditions.length ? " where " + conditions.join(" and ") : "";
    if (options.method === "PATCH") {
      assert.equal(table, "submissions");
      return Response.json(
        (
          await pg.query(
            `update submissions set status=$${values.length + 1}${where} returning *`,
            [...values, data.status],
          )
        ).rows,
      );
    }
    const rows = (await pg.query("select * from " + table + where, values))
      .rows;
    // Honor the projection used by the API; email never leaves auth lookup.
    const select = url.searchParams.get("select");
    return Response.json(
      select
        ? rows.map((r) =>
            Object.fromEntries(select.split(",").map((k) => [k, r[k]])),
          )
        : rows,
    );
  };
  const cookie = adminLogin(
    new Request("https://site.test/api/events", {
      headers: { "x-admin-password": "test-admin-only" },
    }),
  ).split(";")[0];
  async function request(action, method = "GET", data, auth = "") {
    const headers = {
      "Content-Type": "application/json",
      Origin: "https://site.test",
    };
    if (auth === "admin") headers.cookie = cookie;
    if (auth === "user") headers.authorization = "Bearer test.token";
    const r = await handler(
      new Request("https://site.test/api/community?action=" + action, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
      }),
    );
    return { status: r.status, data: await r.json() };
  }
  try {
    assert.equal((await request("admin")).status, 401);
    assert.equal(
      (
        await request(
          "member",
          "POST",
          { name: "İzinli Üye", class: "1" },
          "admin",
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("member", "POST", { name: "Yanlış", class: "9" }, "admin"))
        .status,
      400,
    );
    const content = "<img src=x onerror=alert(1)> güvenli düz metin";
    assert.equal(
      (
        await request("submit", "POST", {
          kind: "experience",
          title: "Staj",
          content,
        })
      ).status,
      201,
    );
    assert.equal((await request("public")).data.experiences.length, 0);
    const list = (await request("admin", "GET", undefined, "admin")).data;
    await request(
      "moderate",
      "POST",
      { id: list.submissions[0].id, status: "approved" },
      "admin",
    );
    assert.equal(
      (await request("public")).data.experiences[0].content,
      content,
    );
    assert.equal(
      (
        await request(
          "me",
          "POST",
          { name: "Öğrenci", public_name: true },
          "user",
        )
      ).status,
      200,
    );
    const batch = randomUUID();
    await pg.query("select create_ticket_batch($1,$2,$3,$4::jsonb)", [
      batch,
      "e1",
      "Etkinlik",
      JSON.stringify(["ERC-AAAAAAAAAAAAAAAAAAAAAAAA"]),
    ]);
    assert.equal(
      (
        await request(
          "claim",
          "POST",
          { code: "ERC-AAAAAAAAAAAAAAAAAAAAAAAA" },
          "user",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "claim",
          "POST",
          { code: "ERC-AAAAAAAAAAAAAAAAAAAAAAAA" },
          "user",
        )
      ).status,
      409,
    );
    const me = await request("me", "GET", undefined, "user");
    assert.equal(me.data.total, 1);
    assert.ok(!JSON.stringify(me.data).includes("private@example"));
    assert.equal(
      (await request("batch", "POST", { count: 201, event_id: "x" }, "admin"))
        .status,
      400,
    );
  } finally {
    globalThis.fetch = fetchOriginal;
    await pg.close();
  }
});
