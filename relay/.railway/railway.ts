// The relay's Railway settings (Infrastructure as Code, which replaced relay/railway.json:
// Railway stops reading that on 2026-12-01). Railway does NOT read this file on a deploy: the
// settings live on the service, and this file changes them only when someone runs, from relay/,
//   npm --prefix .railway ci && railway config plan && railway config apply
// So the release's `railway up` needs nothing new. See docs/DEPLOY.md.
//
// This file is the WHOLE Railway project, kanto-br-relay, which also holds Kanto BR's relay
// (service "relay", deployed from campavao/kanto-battle-royale). A service or variable left out
// here is one `apply` deletes, so the Kanto service stays listed exactly as `railway config pull`
// read it on 2026-11-18. preserve() keeps a variable's value as Railway has it.
import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const hoennRelay = service("hoenn-relay", {
    healthcheck: "/health",
    healthcheckTimeout: 60,
    replicas: { "us-west2": 1 },
    deploy: {
      // A deploy keeps the old relay running for 30 minutes after the new one is up, so a match in
      // progress plays out on the version it started on while new rooms open on the new one
      // (/health reports `drains: true` from RAILWAY_DEPLOYMENT_DRAINING_SECONDS).
      drainingSeconds: 1800,
    },
    env: {
      BR_TRUST_PROXY: preserve(),
    },
  });
  const kantoRelay = service("relay", {
    source: github("campavao/kanto-battle-royale", { checkSuites: false, rootDirectory: "relay" }),
    build: { buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["relay/**"] },
    replicas: { "us-west2": 1 },
    tcp: [7790],
    env: {
      BR_DAILY: preserve(),
      BR_MAX_CONNS: preserve(),
      BR_MAX_ROOMS: preserve(),
      BR_MOTD: preserve(),
      PORT: preserve(),
    },
  });

  return project("kanto-br-relay", {
    resources: [hoennRelay, kantoRelay],
  });
});
