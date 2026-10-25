export const ownerFixtureSession = {
  id: "owner", username: "basadmin", name: "Baş yönetici", role: "owner",
  permissions: [
    "events.view", "events.manage", "events.publish", "registrations.view", "registrations.manage",
    "registrations.receipts", "registrations.photos", "registrations.export", "payments.view", "payments.manage", "statistics.view", "audit.view", "yearbooks.view", "yearbooks.manage", "yearbooks.publish", "tickets.view", "tickets.manage",
    "raffles.view", "raffles.manage", "attendance.view", "attendance.manage", "accounts.view", "accounts.manage",
    "instagram.view", "instagram.manage",
  ],
};

// Use only for tests whose event/admin APIs are already mocked. Real login
// integration tests continue exercising the local server and its signed cookie.
export async function mockOwnerSession(page, { state = {}, onSession } = {}) {
  await page.route("**/api/admin-auth*", route => {
    const request = route.request(), action = new URL(request.url()).searchParams.get("action") || "session";
    if (action === "login" && request.method() === "POST") {
      const input = request.postDataJSON();
      state.authHadPassword = !!input.password;
      state.authUsername = input.username;
      state.authenticated = true;
      return route.fulfill({ json: { session: ownerFixtureSession } });
    }
    if (action === "logout" && request.method() === "POST") {
      state.authenticated = false;
      if (typeof state.logout === "number") state.logout++;
      return route.fulfill({ json: { session: null } });
    }
    if (action === "session" && request.method() === "GET" && onSession) return onSession(route);
    if (action === "session" && request.method() === "GET")
      return route.fulfill({ json: { session: state.authenticated === false ? null : ownerFixtureSession } });
    return route.fulfill({ status: 405, json: { error: "Unsupported mocked authentication action" } });
  });
}
