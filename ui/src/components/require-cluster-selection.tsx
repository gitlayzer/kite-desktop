import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useCluster } from '@/hooks/use-cluster'

export function RequireClusterSelection({ children }: { children: ReactNode }) {
  const { currentCluster, isLoading } = useCluster()
  const location = useLocation()

  if (isLoading) {
    return null
  }

  if (!currentCluster) {
    return <Navigate to="/clusters" replace state={{ from: location }} />
  }

  return <>{children}</>
}
