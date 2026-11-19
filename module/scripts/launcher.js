/**
 * Georgios' launcher (a small helper on the GM's PC, started at login) starts companions on
 * request, since a browser cannot start programs. Here: the offer to start the Nemesis companion
 * when it does not answer. Works with or without the other Georgios modules.
 */

const MODULE_ID = "georgios-nemesis";
const SERVICE = "nemesis";
const L = (key, data) => (data ? game.i18n.format(`GN.Launcher.${key}`, data) : game.i18n.localize(`GN.Launcher.${key}`));
const base = () => (game.settings.get(MODULE_ID, "launcherUrl") || "http://127.0.0.1:47100").replace(/\/+$/, "");

async function call(path, body) {
  const res = await fetch(`${base()}${path}`, body
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    : { signal: AbortSignal.timeout(4000) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `launcher answered ${res.status}`);
  return data;
}

/** Starts the companion through the launcher and waits until it answers. True when it runs. */
export async function startCompanion() {
  try {
    const status = await call("/status");
    if (!status.services?.[SERVICE]) {
      ui.notifications.error(L("NotConfigured"), { permanent: true });
      return false;
    }
    if (status.services[SERVICE].up) return true;
    await call("/start", { service: SERVICE });
  } catch {
    ui.notifications.error(L("NoLauncher"), { permanent: true });
    return false;
  }
  ui.notifications.info(L("Starting"));
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      if ((await call("/status")).services?.[SERVICE]?.up) {
        ui.notifications.info(L("Ready"));
        return true;
      }
    } catch {
      /* ask again */
    }
  }
  ui.notifications.warn(L("Slow"));
  return false;
}

let offered = 0;

/** Offers (once a minute at most) to start the companion that did not answer. */
export async function offerStart() {
  if (!game.user.isGM || Date.now() - offered < 60_000) return false;
  offered = Date.now();
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Georgios' Nemesis" },
    content: `<p>${L("NotRunning")}</p>`,
    yes: { label: L("Start"), icon: "fa-solid fa-play" },
    no: { label: L("NotNow") },
    rejectClose: false,
  });
  return yes ? startCompanion() : false;
}
