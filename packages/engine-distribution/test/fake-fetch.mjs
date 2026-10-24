// Test transport. Routes are matched in order and return real Response
// objects, so the production publisher code runs unchanged. No production
// code is replaced.
export function fakeFetch(routes = []) {
  const calls = [];

  const fetchImpl = async (url, options = {}) => {
    const href = typeof url === 'string' ? url : url.toString();
    const method = String(options.method ?? 'GET').toUpperCase();
    calls.push({
      url: href,
      method,
      headers: options.headers ?? {},
      body: options.body,
    });

    for (const route of routes) {
      if (route.method && route.method !== method) continue;
      if (route.match && !route.match(href, options)) continue;

      const value = typeof route.response === 'function'
        ? await route.response({ url: href, method, options })
        : route.response;

      if (value instanceof Error) throw value;

      // `status` is the HTTP status only when it is a number. Graph container
      // responses also carry a human-readable `status` string.
      const status = typeof value?.status === 'number' ? value.status : 200;
      const payload = Object.prototype.hasOwnProperty.call(value ?? {}, 'body')
        ? value.body
        : value;
      const headers = value?.headers ?? {};

      return new Response(
        payload === undefined || payload === null ? null : JSON.stringify(payload),
        { status, headers: { 'content-type': 'application/json', ...headers } }
      );
    }

    return new Response(
      JSON.stringify({ error: { message: `no route for ${method} ${href}`, code: 999 } }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  };

  fetchImpl.calls = calls;
  return fetchImpl;
}

export function graphPath(href) {
  return new URL(href).pathname;
}

export function graphQuery(href) {
  return new URL(href).searchParams;
}

export function jsonBody(call) {
  return typeof call.body === 'string' ? JSON.parse(call.body) : call.body;
}
