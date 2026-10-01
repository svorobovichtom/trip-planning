/// <reference path="../pb_data/types.d.ts" />

// App settings: name/URL, real client IPs behind Caddy, batch API for
// "Снять все отметки", and a daily backup that keeps the last 7.

migrate((app) => {
  const s = app.settings();

  s.meta.appName = "Поездка";
  const url = $os.getenv("TRIP_URL");
  if (url) s.meta.appURL = url;

  // Caddy sits in front on the same host and sets X-Forwarded-For.
  s.trustedProxy.headers = ["X-Forwarded-For"];
  s.trustedProxy.useLeftmostIP = false;

  s.batch.enabled = true;
  s.batch.maxRequests = 200;
  s.batch.timeout = 10;

  // 03:30 server time (UTC), into pb_data/backups.
  s.backups.cron = "30 3 * * *";
  s.backups.cronMaxKeep = 7;

  app.save(s);
}, (app) => {
  const s = app.settings();
  s.backups.cron = "";
  s.batch.enabled = false;
  app.save(s);
});
