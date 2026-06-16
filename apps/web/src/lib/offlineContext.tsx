import { createContext, useContext, useEffect, useState } from 'react'

interface OfflineContextValue {
  isOffline: boolean
}

export const OfflineContext = createContext<OfflineContextValue>({ isOffline: false })

export function OfflineProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return (
    <OfflineContext.Provider value={{ isOffline }}>
      {children}
    </OfflineContext.Provider>
  )
}

export function useOffline(): OfflineContextValue {
  return useContext(OfflineContext)
}
