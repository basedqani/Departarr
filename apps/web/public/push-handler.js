self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) {}
  const title = data.title || 'Departarr'
  const options = {
    body: data.message || 'Flight update',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.flightId || 'departarr',
    data: data,
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
