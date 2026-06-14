self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) {}
  // title is always set by the server (e.g. "AA 2083 · Departed")
  const title = data.title || 'Departarr'
  // message is the terse body line; empty string is valid (status-only events)
  const body = typeof data.message === 'string' ? data.message : 'Flight update'
  const options = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.flightId ? `flight-${data.flightId}-${data.eventType || 'update'}` : 'departarr',
    renotify: true,
    data,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const d = event.notification.data || {}
  const url = d.flightId ? ('/flights/' + d.flightId) : '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) { c.navigate && c.navigate(url); return c.focus() } }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
