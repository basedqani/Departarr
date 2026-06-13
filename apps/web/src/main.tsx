import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import '@fontsource-variable/inter'
import App from './App'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1000, // 24h for offline cache
    },
  },
})

const persister = createSyncStoragePersister({
  storage: window.localStorage,
})

// Persist flight/trip data for offline use, but NEVER persist auth/config
// state (me, features, settings). Those must always be revalidated from the
// network so a promoted admin — or a signed-out user — is never read back from
// stale localStorage.
const NON_PERSISTED_KEYS = new Set(['me', 'features', 'settings'])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            if (NON_PERSISTED_KEYS.has(query.queryKey?.[0] as string)) return false
            return query.state.status === 'success'
          },
        },
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </React.StrictMode>
)
