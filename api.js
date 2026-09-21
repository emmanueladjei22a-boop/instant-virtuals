async function api(path, opts = {}) {
  const token = localStorage.getItem("iv_token") || "";
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(opts.headers || {}),
    },
    ...opts,
    body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (data && data.token) localStorage.setItem("iv_token", data.token);
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
