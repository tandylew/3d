/* twilio-invite.js — sends an SMS invite to this page via the Twilio REST API.
 *
 * Account SID / From / To / Message are saved with kstore so they survive a
 * refresh. The Auth Token is kept in sessionStorage only (this tab, this
 * visit) — it's a secret and kstore's server-backed writes land in the
 * repo's data/ directory, which is the wrong place for it.
 *
 * Twilio's REST API generally does not send CORS headers, so a direct
 * browser fetch is often rejected by the browser itself before Twilio ever
 * sees it. When that happens we show the equivalent curl command instead.
 */
(async () => {
  const sidEl = document.getElementById("twSid");
  const tokenEl = document.getElementById("twToken");
  const fromEl = document.getElementById("twFrom");
  const toEl = document.getElementById("twTo");
  const bodyEl = document.getElementById("twBody");
  const form = document.getElementById("inviteForm");
  const sendBtn = document.getElementById("twSend");
  const statusEl = document.getElementById("twStatus");
  const curlEl = document.getElementById("twCurl");

  const TOKEN_KEY = "kstore-3d-twilio-token"; // sessionStorage, not kstore

  bodyEl.value = `You're invited! Check out ${location.href}`;

  await kstore.ready;
  const saved = await kstore.get("twilio/invite", null);
  if (saved) {
    sidEl.value = saved.sid || "";
    fromEl.value = saved.from || "";
    toEl.value = saved.to || "";
    if (saved.body) bodyEl.value = saved.body;
  }
  tokenEl.value = sessionStorage.getItem(TOKEN_KEY) || "";

  function saveFields() {
    kstore.set("twilio/invite", {
      sid: sidEl.value.trim(), from: fromEl.value.trim(),
      to: toEl.value.trim(), body: bodyEl.value,
    });
    sessionStorage.setItem(TOKEN_KEY, tokenEl.value);
  }
  [sidEl, fromEl, toEl, bodyEl, tokenEl].forEach((el) =>
    el.addEventListener("change", saveFields)
  );

  function setStatus(kind, text) {
    statusEl.className = "status " + kind;
    statusEl.textContent = text;
  }

  function showCurl(sid, token, from, to, body) {
    curlEl.style.display = "block";
    curlEl.textContent =
      `curl -X POST "https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json" \\\n` +
      `  -u "${sid}:${token}" \\\n` +
      `  --data-urlencode "From=${from}" \\\n` +
      `  --data-urlencode "To=${to}" \\\n` +
      `  --data-urlencode "Body=${body}"`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    saveFields();
    curlEl.style.display = "none";

    const sid = sidEl.value.trim();
    const token = tokenEl.value;
    const from = fromEl.value.trim();
    const to = toEl.value.trim();
    const body = bodyEl.value;

    if (!sid || !token || !from || !to || !body.trim()) {
      setStatus("err", "Fill in Account SID, Auth Token, From, To, and the message.");
      return;
    }

    sendBtn.disabled = true;
    setStatus("pending", "Sending…");

    const params = new URLSearchParams({ From: from, To: to, Body: body });
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(`${sid}:${token}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus("ok", `Sent! Message SID: ${data.sid || "(unknown)"}`);
      } else {
        setStatus("err", `Twilio rejected the request: ${data.message || res.status}`);
        showCurl(sid, token, from, to, body);
      }
    } catch (err) {
      setStatus(
        "err",
        "Couldn't reach Twilio from the browser (likely blocked by CORS). " +
          "Run the command below from a terminal instead, or send it through your own backend."
      );
      showCurl(sid, token, from, to, body);
    } finally {
      sendBtn.disabled = false;
    }
  });
})();
